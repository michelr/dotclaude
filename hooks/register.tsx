import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import { displaySql, inlineDbtSql, isGroupedColumn, isNumeric, parseDbtShow, parseJsonRows, type Table, withThousands } from './parse'

const BIGQUERY_TOOL = 'mcp__bigquery__execute_sql'
const MAX_CELL = 32
const MAX_ROWS = 50
const MAX_SQL = 10000
const SEPARATOR = ' │ '
const DBT_SQL = { plugin: 'query-table', key: 'dbtSql' } as const

const length = (text: string) => [...text].length

const fit = (text: string, width: number, alignRight: boolean): string => {
  const clipped = length(text) > width ? `${[...text].slice(0, width - 1).join('')}…` : text
  const padding = ' '.repeat(width - length(clipped))
  return alignRight ? padding + clipped : clipped + padding
}

const layout = (table: Table, available: number) => {
  const isNumberColumn = table.columns.map((_, i) =>
    table.rows.some(row => isNumeric(row[i] ?? '')) && table.rows.every(row => row[i] === '∅' || isNumeric(row[i] ?? '')),
  )
  const rows = table.rows.map(row =>
    row.map((cell, i) => (isNumberColumn[i] && isGroupedColumn(table.columns[i] ?? '') ? withThousands(cell) : cell)),
  )
  const widths = table.columns.map((column, i) =>
    Math.min(MAX_CELL, Math.max(length(column), ...rows.map(row => length(row[i] ?? '')))),
  )
  let used = 0
  const visible = widths.findIndex(width => (used += width + length(SEPARATOR)) > available + length(SEPARATOR))
  const shown = visible < 0 ? widths.length : Math.max(1, visible)
  return { rows, widths: widths.slice(0, shown), isNumberColumn, hidden: widths.length - shown }
}

const toTable = (tool: string, output: unknown): Table | undefined => {
  if (tool === BIGQUERY_TOOL) return parseJsonRows(output)
  if (tool !== 'Bash') return undefined
  const stdout = (output as { stdout?: unknown })?.stdout
  return typeof stdout === 'string' ? parseDbtShow(stdout) : undefined
}

const sqlOf = (input: unknown): string | undefined => {
  const sql = (input as { sql?: unknown })?.sql
  return typeof sql === 'string' ? displaySql(sql).slice(0, MAX_SQL) : undefined
}

const drawTable = ({ Box, Text, Code }: ElementTable, tool: string, table: Table, available: number, sql?: string) => {
  const { rows: formattedRows, widths, isNumberColumn, hidden } = layout(table, available)
  const rows = formattedRows.slice(0, MAX_ROWS)
  const tableWidth = widths.reduce((sum, width) => sum + width, 0) + length(SEPARATOR) * (widths.length - 1)
  const ruleWidth = Math.min(available, Math.max(tableWidth, ...(sql ?? '').split('\n').map(length)))
  const source = tool === BIGQUERY_TOOL ? 'BigQuery' : 'dbt show'
  const summary = [
    `${table.rows.length} row${table.rows.length === 1 ? '' : 's'}`,
    `${table.columns.length} column${table.columns.length === 1 ? '' : 's'}`,
    hidden ? `${hidden} hidden (too wide)` : '',
    table.rows.length > MAX_ROWS ? `showing first ${MAX_ROWS}` : '',
  ].filter(Boolean)

  const line = (cells: string[], render: (text: string, i: number) => RenderChildren) => (
    <Box flexDirection="row">
      {widths.map((width, i) => (
        <Text wrap="truncate">
          {i ? <Text dimColor>{SEPARATOR}</Text> : ''}
          {render(fit(cells[i] ?? '', width, isNumberColumn[i] ?? false), i)}
        </Text>
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text>
        <Text bold color="magenta">{source}</Text>
        <Text dimColor> · {summary.join(' · ')}</Text>
      </Text>
      {sql ? <Code source={sql} language="sql" wrap="wrap" /> : ''}
      {sql ? <Text dimColor wrap="truncate">{'─'.repeat(ruleWidth)}</Text> : ''}
      {line(table.columns, text => <Text bold underline color="cyan">{text}</Text>)}
      {rows.map(row =>
        line(row, (text, i) =>
          row[i] === '∅' ? (
            <Text dimColor italic>{text}</Text>
          ) : isNumberColumn[i] && row[i]?.startsWith('-') ? (
            <Text color="red">{text}</Text>
          ) : (
            <Text>{text}</Text>
          ),
        ),
      )}
      {table.notes.map(note => <Text dimColor wrap="truncate">{note}</Text>)}
    </Box>
  )
}

const headerSqlOf = async ($: EngineInterface, tool: string, toolUseId: string, input?: unknown): Promise<string | undefined> => {
  if (tool === BIGQUERY_TOOL) return sqlOf(input)
  const { value } = await $.state.get({ ...DBT_SQL, id: toolUseId })
  return value ? displaySql(value).slice(0, MAX_SQL) : undefined
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) =>
    !e.props.isExpanded && e.props.calls.some(call => call.tool === BIGQUERY_TOOL)
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e),
  )

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const sql = inlineDbtSql(e.command)
    if (sql) await $.state.set({ ...DBT_SQL, id: e.tool_use_id }, sql)
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const table = e.props.isRunning || e.props.isErrored ? undefined : toTable(e.props.tool, e.props.output)
    if (!table?.columns.length) return next(e)
    const sql = await headerSqlOf($, e.props.tool, e.props.tool_use_id, e.props.input)
    return sql || e.props.tool === BIGQUERY_TOOL
      ? drawTable($.ui.resolve(e), e.props.tool, table, (e.viewport?.columns ?? 120) - 6, sql)
      : next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const table = e.props.isErrored ? undefined : toTable(e.props.tool, e.props.output)
    if (!table?.columns.length) return next(e)
    const elements = $.ui.resolve(e)
    const drawnAbove = e.props.tool === BIGQUERY_TOOL || (await headerSqlOf($, e.props.tool, e.props.tool_use_id))
    return drawnAbove ? <elements.Box /> : drawTable(elements, e.props.tool, table, (e.viewport?.columns ?? 120) - 6)
  })
}
