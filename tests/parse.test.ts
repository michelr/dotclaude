import { expect, test } from 'claude-code/testing'

import { displaySql, inlineDbtSql, isGroupedColumn, parseDbtShow, parseJsonRows, withThousands } from '../hooks/parse'

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
