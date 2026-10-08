import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { BashQuery } from '../types'
import { bashQueryOf, displaySql, isGroupedColumn, isNumeric, mcpQuerySource, parseBqOutput, parseDbtShow, parseJsonRows, type Table, textOf, withThousands } from './parse'

const MAX_CELL = 32
const MAX_ROWS = 50
const MAX_SQL = 10000
const SEPARATOR = ' │ '
const BASH_QUERY = { plugin: 'query-table', key: 'bashQuery' } as const

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

type Query = { source: string; sql?: string }

const toTable = (tool: string, output: unknown, query: Query): Table | undefined => {
  if (mcpQuerySource(tool)) return parseJsonRows(output) ?? parseDbtShow(textOf(output) ?? '')
  const stdout = (output as { stdout?: unknown })?.stdout
  if (typeof stdout !== 'string') return undefined
  return query.source === 'bq query' ? parseBqOutput(stdout) : parseDbtShow(stdout)
}

const sqlOf = (input: unknown): string | undefined => {
  const fields = input as { sql?: unknown; sql_query?: unknown; query?: unknown } | undefined
  const sql = [fields?.sql, fields?.sql_query, fields?.query].find(value => typeof value === 'string')
  return typeof sql === 'string' ? displaySql(sql).slice(0, MAX_SQL) : undefined
}

const drawTable = ({ Box, Text, Code }: ElementTable, source: string, table: Table, available: number, sql?: string) => {
  const { rows: formattedRows, widths, isNumberColumn, hidden } = layout(table, available)
  const rows = formattedRows.slice(0, MAX_ROWS)
  const tableWidth = widths.reduce((sum, width) => sum + width, 0) + length(SEPARATOR) * (widths.length - 1)
  const ruleWidth = Math.min(available, Math.max(tableWidth, ...(sql ?? '').split('\n').map(length)))
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

const queryOf = async ($: EngineInterface, tool: string, toolUseId: string, input?: unknown): Promise<Query | undefined> => {
  const source = mcpQuerySource(tool)
  if (source) return { source, sql: sqlOf(input) }
  if (tool !== 'Bash') return undefined
  const { value }: { value?: BashQuery } = await $.state.get({ ...BASH_QUERY, id: toolUseId })
  return value ? { ...value, sql: value.sql && displaySql(value.sql).slice(0, MAX_SQL) } : { source: 'dbt show' }
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) =>
    !e.props.isExpanded && e.props.calls.some(call => mcpQuerySource(call.tool))
      ? next({ ...e, props: { ...e.props, isExpanded: true } })
      : next(e),
  )

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const query = bashQueryOf(e.command)
    if (query) await $.state.set({ ...BASH_QUERY, id: e.tool_use_id }, query)
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isRunning || e.props.isErrored) return next(e)
    const query = await queryOf($, e.props.tool, e.props.tool_use_id, e.props.input)
    const table = query && toTable(e.props.tool, e.props.output, query)
    if (!query || !table?.columns.length) return next(e)
    return query.sql || mcpQuerySource(e.props.tool)
      ? drawTable($.ui.resolve(e), query.source, table, (e.viewport?.columns ?? 120) - 6, query.sql)
      : next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const query = await queryOf($, e.props.tool, e.props.tool_use_id)
    const table = query && toTable(e.props.tool, e.props.output, query)
    if (!query || !table?.columns.length) return next(e)
    const elements = $.ui.resolve(e)
    const drawnAbove = mcpQuerySource(e.props.tool) || query.sql
    return drawnAbove ? <elements.Box /> : drawTable(elements, query.source, table, (e.viewport?.columns ?? 120) - 6)
  })
}
