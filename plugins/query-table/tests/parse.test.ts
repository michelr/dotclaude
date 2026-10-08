import { expect, test } from 'claude-code/testing'

import { bashQueryOf, displaySql, inlineDbtSql, isGroupedColumn, mcpQuerySource, parseBqOutput, parseDbtShow, parseJsonRows, withThousands } from '../hooks/parse'

const DBT_SHOW = `dbt-fusion 2.0.0-preview.189
   Loading ~/.dbt/profiles.yml
Query show_sql_operation_inline
┌─────────────┬──────────────────┬──────────────┐
│ report_date ┆ transaction_type ┆ total_amount │
╞═════════════╪══════════════════╪══════════════╡
│ 2026-09-28  ┆ FEE              ┆ -123456.78   │
│ 2026-09-29  ┆ CASH             ┆ 654321.      │
└─────────────┴──────────────────┴──────────────┘
24 rows.
 Succeeded [  2.82s] model dbt.inline (ephemeral)

==================== Execution Summary =====================`

test('parses a dbt show table', () => {
  expect(parseDbtShow(DBT_SHOW)).toEqual({
    columns: ['report_date', 'transaction_type', 'total_amount'],
    rows: [
      ['2026-09-28', 'FEE', '-123456.78'],
      ['2026-09-29', 'CASH', '654321'],
    ],
    notes: ['Succeeded [  2.82s] model dbt.inline (ephemeral)'],
  })
})

test('ignores Bash output without a table', () => {
  expect(parseDbtShow('hello\nworld')).toBeUndefined()
})

test('parses MCP rows given one JSON object per block', () => {
  const output = [
    { type: 'text', text: '{"day":"2026-10-01","n":3}' },
    { type: 'text', text: '{"day":"2026-10-02","n":null}' },
  ]
  expect(parseJsonRows(output)).toEqual({
    columns: ['day', 'n'],
    rows: [
      ['2026-10-01', '3'],
      ['2026-10-02', '∅'],
    ],
    notes: [],
  })
})

test('parses MCP rows given a JSON array', () => {
  expect(parseJsonRows('[{"a":1},{"a":2,"b":"x"}]')?.rows).toEqual([
    ['1', '∅'],
    ['2', 'x'],
  ])
})

test('parses MCP rows concatenated in one text block', () => {
  const text = '{"day":"2026-10-01","note":"a}{\\"b"}{"day":"2026-10-02","note":null}'
  expect(parseJsonRows([{ type: 'text', text }])?.rows).toEqual([
    ['2026-10-01', 'a}{"b'],
    ['2026-10-02', '∅'],
  ])
})

test('leaves non-tabular MCP text alone', () => {
  expect(parseJsonRows([{ type: 'text', text: 'query failed' }])).toBeUndefined()
})

test('keeps a single row whose column holds an array of records', () => {
  const text = '{"id":1,"items":[{"sku":"a"},{"sku":"b"}]}'
  expect(parseJsonRows(text)).toEqual({
    columns: ['id', 'items'],
    rows: [['1', '[{"sku":"a"},{"sku":"b"}]']],
    notes: [],
  })
})

test('unwraps an object whose only key holds the rows', () => {
  expect(parseJsonRows('{"rows":[{"a":1},{"a":2}]}')?.rows).toEqual([['1'], ['2']])
})

test('strips the trailing dot from dbt numbers only', () => {
  const stdout = DBT_SHOW.replace('FEE             ', 'Acme Inc.       ')
  expect(parseDbtShow(stdout)?.rows[0]).toEqual(['2026-09-28', 'Acme Inc.', '-123456.78'])
})

test('ignores box tables from tools other than dbt', () => {
  expect(parseDbtShow(DBT_SHOW.replace('dbt-fusion 2.0.0-preview.189', 'duckdb v1.1'))).toBeUndefined()
})

test("keeps the query's own lines and drops the shared indent", () => {
  const sql = "\n\n    select\n        a\n        , b -- note\n\n    from t   \n  \n"
  expect(displaySql(sql)).toBe('select\n    a\n    , b -- note\n\nfrom t')
})

test('leaves a one-line query alone', () => {
  expect(displaySql('select 1')).toBe('select 1')
})

test('reads the SQL of a double-quoted dbt show --inline', () => {
  const command = 'cd x && uv run dbt show --inline "select\n    \\"a\\" as b\n    , \'c\'\nfrom t" --target prod_bq --limit 5'
  expect(inlineDbtSql(command)).toBe('select\n    "a" as b\n    , \'c\'\nfrom t')
})

test('reads the SQL of a single-quoted dbt show --inline', () => {
  expect(inlineDbtSql("dbt show --inline='select \"x\" from t' --limit 1")).toBe('select "x" from t')
})

test('gives no SQL it cannot read from the command alone', () => {
  expect(inlineDbtSql('uv run dbt show --inline "$(cat q.sql)" --target prod_bq')).toBeUndefined()
  expect(inlineDbtSql('uv run dbt show --select my_model')).toBeUndefined()
  expect(inlineDbtSql('echo "--inline \'select 1\'"')).toBeUndefined()
})

test('groups the integer part of plain numbers by thousands', () => {
  expect(withThousands('-1234567.89')).toBe('-1,234,567.89')
  expect(withThousands('9876543.2101')).toBe('9,876,543.2101')
  expect(withThousands('999')).toBe('999')
  expect(withThousands('1000')).toBe('1,000')
})

test('leaves numbers it should not group alone', () => {
  expect(withThousands('1,000')).toBe('1,000')
  expect(withThousands('1e+21')).toBe('1e+21')
  expect(withThousands('∅')).toBe('∅')
})

test('skips id, key and year columns', () => {
  expect(['user_id', 'id', 'loanpro_snapshot_key', 'report_year', 'total_amount', 'idle_days'].map(isGroupedColumn)).toEqual([
    false, false, false, false, true, true,
  ])
})

const BQ_PRETTY = `Waiting on bqjob_r37d_1 ... (0s) Current status: RUNNING\rWaiting on bqjob_r37d_1 ... (0s) Current status: DONE   
+-------------+------------------+--------------+---------+
| report_date | transaction_type | total_amount | note    |
+-------------+------------------+--------------+---------+
|  2026-09-28 | ADM              |   -895247.36 | a | b   |
|  2026-09-29 | PMC2             |       843992 | NULL    |
+-------------+------------------+--------------+---------+`

test('parses a bq pretty table, splitting cells on the border corners', () => {
  expect(parseBqOutput(BQ_PRETTY)).toEqual({
    columns: ['report_date', 'transaction_type', 'total_amount', 'note'],
    rows: [
      ['2026-09-28', 'ADM', '-895247.36', 'a | b'],
      ['2026-09-29', 'PMC2', '843992', '∅'],
    ],
    notes: [],
  })
})

test('parses a bq table cut short by head', () => {
  const cut = BQ_PRETTY.split('\n').slice(0, 5).join('\n')
  expect(parseBqOutput(cut)?.rows).toEqual([['2026-09-28', 'ADM', '-895247.36', 'a | b']])
})

test('gives no bq table when tail cut off its header', () => {
  expect(parseBqOutput(BQ_PRETTY.split('\n').slice(4).join('\n'))).toBeUndefined()
})

test('parses bq json output', () => {
  expect(parseBqOutput('[{"n":"1","s":null}]')?.rows).toEqual([['1', '∅']])
})

test('leaves bq output without rows alone', () => {
  expect(parseBqOutput('BigQuery error in query operation: Not found')).toBeUndefined()
})

test('reads the SQL of a bq query command', () => {
  const command = 'bq query --use_legacy_sql=false --format=pretty --project_id=p "select a\n    from \\`p.d.t\\`" 2>&1 | tail -40'
  expect(bashQueryOf(command)).toEqual({ source: 'bq query', sql: 'select a\n    from `p.d.t`' })
  expect(bashQueryOf("bq --location=US query --nouse_legacy_sql 'with x as (select 1) select * from x'")).toEqual({
    source: 'bq query',
    sql: 'with x as (select 1) select * from x',
  })
})

test('knows a bq query without readable SQL, and ignores other bq commands', () => {
  expect(bashQueryOf('bq query --nouse_legacy_sql < q.sql')).toEqual({ source: 'bq query' })
  expect(bashQueryOf('bq show --format=pretty p:d.t')).toBeUndefined()
  expect(bashQueryOf('uv run dbt show --select m')).toEqual({ source: 'dbt show' })
})

test('parses dbt show under the dbt 2.x banner', () => {
  expect(parseDbtShow(DBT_SHOW.replace('dbt-fusion 2.0.0-preview.189', 'dbt 2.0.6'))?.notes).toEqual([
    'Succeeded [  2.82s] model dbt.inline (ephemeral)',
  ])
})

test('unwraps rows kept beside other keys, as the dbt MCP returns them', () => {
  const text = '{"results":[{"a":1},{"a":2}],"columns":["a"],"row_count":2}'
  expect(parseJsonRows([{ type: 'text', text }])?.rows).toEqual([['1'], ['2']])
})

test('finds the JSON rows after dbt log lines', () => {
  const text = 'dbt 2.0.6\n   Loading profiles.yml\n{"show":[{"a":1},{"a":null}]}\n1 rows.'
  expect(parseJsonRows(text)?.rows).toEqual([['1'], ['∅']])
})

test('recognises query tools on any BigQuery or dbt MCP server', () => {
  expect(mcpQuerySource('mcp__bigquery__execute_sql')).toBe('BigQuery')
  expect(mcpQuerySource('mcp__claude_ai_Google_Cloud_BigQuery__execute_sql')).toBe('BigQuery')
  expect(mcpQuerySource('mcp__claude_ai_Google_Cloud_BigQuery__query')).toBe('BigQuery')
  expect(mcpQuerySource('mcp__dbt__show')).toBe('dbt show')
  expect(mcpQuerySource('mcp__plugin_dbt_dbt-mcp__show')).toBe('dbt show')
  expect(mcpQuerySource('mcp__dbt__execute_sql')).toBe('dbt SQL')
  expect(mcpQuerySource('mcp__bigquery__list_dataset_ids')).toBeUndefined()
  expect(mcpQuerySource('mcp__dbt__list')).toBeUndefined()
  expect(mcpQuerySource('mcp__postgres__query')).toBeUndefined()
  expect(mcpQuerySource('Bash')).toBeUndefined()
})
