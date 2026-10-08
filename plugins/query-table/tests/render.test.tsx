import { expect, test, type TestBody } from 'claude-code/testing'

const BIGQUERY_ROW = {
  tool_use_id: 'toolu_1',
  tool: 'mcp__bigquery__execute_sql',
  input: { sql: 'select\n  1 as n -- one\nfrom t' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: [{ type: 'text', text: '{"n":"1"}' }],
}

test('a BigQuery row draws the table once under the SQL and a rule', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { input?: { sql?: string }; output?: unknown }
    return <Text>{`engine ${e.component} ${props.input?.sql ?? ''} output=${props.output === undefined ? 'none' : 'raw'}`}</Text>
  })

  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', props: BIGQUERY_ROW })
  expect(await use.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect((await use.find({ type: 'Code' }))?.props).toMatchObject({ source: 'select\n  1 as n -- one\nfrom t', language: 'sql', wrap: 'wrap' })
  expect(await use.findAll({ type: 'Text', text: /^BigQuery$/ })).toHaveLength(1)
  expect(await use.find({ type: 'Text', text: /^─{15}$/ })).toBeDefined()

  const result = await $.ui.mount({
    plugin: 'query-table',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_1', tool: BIGQUERY_ROW.tool, output: BIGQUERY_ROW.output, isErrored: false },
  })
  expect(await result.find({ type: 'Text', text: /BigQuery|engine/ })).toBeUndefined()
})

const DBT_STDOUT = `dbt-fusion 2.0.0-preview.189
┌─────┐
│ n   │
╞═════╡
│ 1.  │
└─────┘
1 rows.`

const dbtRow = (id: string, command: string) => ({
  tool_use_id: id,
  tool: 'Bash',
  input: { command },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: { stdout: DBT_STDOUT, stderr: '', interrupted: false },
})

const engineRows = (on: Parameters<TestBody>[1]) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine ${e.component}`}</Text>
  })
  on('tool.call', () => ({ result: { stdout: DBT_STDOUT, stderr: '', interrupted: false } }))
}

test('a dbt show --inline row draws the table once under its SQL', async ($, on) => {
  engineRows(on)
  const command = 'uv run dbt show --inline "select\n    1 as n" --target prod_bq'
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_2', command })

  const row = dbtRow('toolu_2', command)
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_2', props: row })
  expect(await use.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect((await use.find({ type: 'Code' }))?.props).toMatchObject({ source: 'select\n    1 as n', language: 'sql' })
  expect(await use.find({ type: 'Text', text: /^dbt show$/ })).toBeDefined()

  const result = await $.ui.mount({
    plugin: 'query-table',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_2',
    props: { tool_use_id: 'toolu_2', tool: 'Bash', output: row.output, isErrored: false },
  })
  expect(await result.find({ type: 'Text', text: /dbt show|engine/ })).toBeUndefined()
})

test('a dbt show without inline SQL keeps its row and draws the table below', async ($, on) => {
  engineRows(on)
  const command = 'uv run dbt show --select my_model'
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_3', command })

  const row = dbtRow('toolu_3', command)
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_3', props: row })
  expect(await use.find({ type: 'Text', text: 'engine ToolUse' })).toBeDefined()

  const result = await $.ui.mount({
    plugin: 'query-table',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_3',
    props: { tool_use_id: 'toolu_3', tool: 'Bash', output: row.output, isErrored: false },
  })
  expect(await result.find({ type: 'Text', text: /^dbt show$/ })).toBeDefined()
  expect(await result.find({ type: 'Code' })).toBeUndefined()
})

test('number columns get thousand separators, id columns do not', async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  const props = {
    ...BIGQUERY_ROW,
    output: [{ type: 'text', text: '{"user_id":"1234567","total_amount":"-1234567.89"}' }],
  }
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', props })
  expect(await use.find({ type: 'Text', text: /^ *-1,234,567\.89$/ })).toBeDefined()
  expect(await use.find({ type: 'Text', text: /^1234567$/ })).toBeDefined()
})

const BQ_STDOUT = `+-------------+--------------+
| report_date | total_amount |
+-------------+--------------+
|  2026-09-28 |   -895247.36 |
+-------------+--------------+`

test('a bq query row draws the table once under its SQL', async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: `engine ${e.component}` }))
  on('tool.call', () => ({ result: { stdout: BQ_STDOUT, stderr: '', interrupted: false } }))
  const command = 'bq query --use_legacy_sql=false "select report_date, total_amount from t" 2>&1'
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_4', command })

  const output = { stdout: BQ_STDOUT, stderr: '', interrupted: false }
  const props = { tool_use_id: 'toolu_4', tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false, output }
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_4', props })
  expect(await use.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect((await use.find({ type: 'Code' }))?.props).toMatchObject({ source: 'select report_date, total_amount from t' })
  expect(await use.find({ type: 'Text', text: /^bq query$/ })).toBeDefined()
  expect(await use.find({ type: 'Text', text: /^ *-895,247\.36$/ })).toBeDefined()

  const result = await $.ui.mount({
    plugin: 'query-table',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_4',
    props: { tool_use_id: 'toolu_4', tool: 'Bash', output, isErrored: false },
  })
  expect(await result.find({ type: 'Text', text: /bq query|engine/ })).toBeUndefined()
})

test('a dbt MCP show row draws its rows under the SQL', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine ${e.component}`}</Text>
  })
  const props = {
    ...BIGQUERY_ROW,
    tool_use_id: 'toolu_dbt',
    tool: 'mcp__dbt__show',
    input: { sql_query: "select n from {{ ref('t') }}", limit: 5 },
    output: [{ type: 'text', text: '{"results":[{"n":"1"},{"n":"2"}],"columns":["n"]}' }],
  }
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', props })
  expect(await use.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect((await use.find({ type: 'Code' }))?.props).toMatchObject({ source: "select n from {{ ref('t') }}" })
  expect(await use.findAll({ type: 'Text', text: /^dbt show$/ })).toHaveLength(1)
  expect(await use.find({ type: 'Text', text: / · 2 rows · 1 column/ })).toBeDefined()
})

test("the claude.ai BigQuery connector's rows draw as a table", async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`engine ${e.component}`}</Text>
  })
  const props = { ...BIGQUERY_ROW, tool_use_id: 'toolu_connector', tool: 'mcp__claude_ai_Google_Cloud_BigQuery__execute_sql' }
  const use = await $.ui.mount({ plugin: 'query-table', surface: 'terminal', component: 'ToolUse', props })
  expect(await use.find({ type: 'Text', text: /engine/ })).toBeUndefined()
  expect(await use.findAll({ type: 'Text', text: /^BigQuery$/ })).toHaveLength(1)
})
