import type { BashQuery } from '../types'

export type Table = { columns: string[]; rows: string[][]; notes: string[] }

const NUMERIC = /^-?\d[\d,]*\.?\d*(e[+-]?\d+)?$/i
const DBT_ROW = /^│(.*)│$/
const DBT_BORDER = /^[┌╞├└]/
const DBT_BANNER = /^\s*dbt(?:-fusion)? v?\d/
const DBT_TRAILING_DOT = /^-?\d[\d,]*\.$/

export const isNumeric = (value: string): boolean => NUMERIC.test(value.trim())

export const textOf = (output: unknown): string | undefined => {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const texts = output.map(block => (block as { text?: unknown })?.text).filter(t => typeof t === 'string')
    return texts.length ? texts.join('\n') : undefined
  }
  if (output && typeof output === 'object' && 'content' in output) return textOf((output as { content: unknown }).content)
  return undefined
}

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const splitConcatenatedObjects = (text: string): string[] => {
  const objects: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (char === '"' && !escaped) inString = false
      escaped = !escaped && char === '\\'
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' && depth++ === 0) start = i
    else if (char === '}' && --depth === 0) objects.push(text.slice(start, i + 1))
  }
  return objects
}

const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isRecord)

const ROW_KEYS = ['rows', 'results', 'show', 'data']

const wrappedRows = (value: Record<string, unknown>): Record<string, unknown>[] | undefined => {
  const entries = Object.entries(value)
  const [, rows] = entries.find(([key, rows]) => ROW_KEYS.includes(key) && isRecordArray(rows)) ?? (entries.length === 1 ? entries[0]! : [])
  return isRecordArray(rows) ? rows : undefined
}

const recordsOf = (text: string): Record<string, unknown>[] | undefined => {
  const whole = tryJson(text.trim())
  if (isRecordArray(whole)) return whole
  if (isRecord(whole)) return wrappedRows(whole) ?? [whole]
  const objects = splitConcatenatedObjects(text).map(tryJson)
  if (!objects.length || !objects.every(isRecord)) return undefined
  const records = objects as Record<string, unknown>[]
  return (records.length === 1 && wrappedRows(records[0]!)) || records
}

const cell = (value: unknown): string =>
  value === null || value === undefined ? '∅' : typeof value === 'object' ? JSON.stringify(value) : String(value)

export const parseJsonRows = (output: unknown): Table | undefined => {
  const text = textOf(output)
  const records = text ? recordsOf(text) : undefined
  if (!records) return undefined
  const columns = [...new Set(records.flatMap(Object.keys))]
  return { columns, rows: records.map(r => columns.map(c => cell(r[c]))), notes: [] }
}

const splitDbtRow = (line: string): string[] =>
  (line.match(DBT_ROW)?.[1] ?? '').split('┆').map(c => c.trim())

const dbtCell = (value: string): string =>
  value === 'null' ? '∅' : DBT_TRAILING_DOT.test(value) ? value.slice(0, -1) : value

export const parseDbtShow = (stdout: string): Table | undefined => {
  if (!DBT_BANNER.test(stdout)) return undefined
  const lines = stdout.split('\n')
  const start = lines.findIndex(l => l.startsWith('┌'))
  const end = lines.findIndex(l => l.startsWith('└'))
  if (start < 0 || end < start) return undefined
  const body = lines.slice(start, end + 1).filter(l => !DBT_BORDER.test(l) && DBT_ROW.test(l))
  if (!body.length) return undefined
  const [header = [], ...rows] = body.map(splitDbtRow)
  const notes = [...lines.slice(0, start), ...lines.slice(end + 1)]
    .map(l => l.trim())
    .filter(l => l && !/^(dbt(-fusion)? v?\d|Loading |Query show_sql|\d+ rows?\.|=+ .* =+$)/.test(l))
  return { columns: header, rows: rows.map(r => r.map(dbtCell)), notes }
}

export const displaySql = (sql: string): string => {
  const lines = sql.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd())
  const body = lines.slice(lines.findIndex(Boolean), lines.findLastIndex(Boolean) + 1)
  const indent = Math.min(...body.filter(Boolean).map(line => line.length - line.trimStart().length))
  return body.map(line => line.slice(indent)).join('\n')
}

const DBT_SHOW_COMMAND = /(^|[^\w-])dbt\s+show(\s|$)/
const INLINE_FLAG = /\s--inline(?:=|\s+)/

const unquoteDouble = (text: string): string | undefined => {
  let value = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') return value
    if (char === '`' || (char === '$' && text[i + 1] === '(')) return undefined
    if (char === '\\' && '"\\$`\n'.includes(text[i + 1] ?? '')) {
      if (text[++i] !== '\n') value += text[i]
      continue
    }
    value += char
  }
  return undefined
}

export const inlineDbtSql = (command: string): string | undefined => {
  if (!DBT_SHOW_COMMAND.test(command)) return undefined
  const flag = INLINE_FLAG.exec(command)
  if (!flag) return undefined
  const rest = command.slice(flag.index + flag[0].length)
  if (rest.startsWith('"')) return unquoteDouble(rest.slice(1))
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1)
    return end < 0 ? undefined : rest.slice(1, end)
  }
  return undefined
}

const PLAIN_NUMBER = /^(-?)(\d+)(\.\d+)?$/
const UNGROUPED_COLUMN = /(^|_)(id|key|year)$/i

export const isGroupedColumn = (column: string): boolean => !UNGROUPED_COLUMN.test(column)

export const withThousands = (value: string): string => {
  const match = PLAIN_NUMBER.exec(value)
  if (!match) return value
  const [, sign = '', digits = '', fraction = ''] = match
  return sign + digits.replace(/\B(?=(\d{3})+$)/g, ',') + fraction
}

const BQ_QUERY_COMMAND = /(^|[^\w-])bq\s+(?:-\S+\s+)*query(\s|$)/
const BQ_PROGRESS = /^\s*Waiting on \S+ \.\.\./
const BQ_BORDER = /^\+(-+\+)+$/
const SQL_START = /^\s*(\(|select|with|insert|update|delete|merge|create|declare)\b/i

const bqCellBounds = (border: string): [number, number][] => {
  const corners = [...border].flatMap((char, i) => (char === '+' ? [i] : []))
  return corners.slice(1).map((end, i) => [(corners[i] ?? 0) + 1, end])
}

const splitBqRow = (line: string, bounds: [number, number][]): string[] => {
  const chars = [...line]
  return bounds.map(([start, end]) => chars.slice(start, end).join('').trim())
}

const parseBqPretty = (lines: string[]): Table | undefined => {
  const start = lines.findIndex((l, i) => BQ_BORDER.test(l) && lines[i + 1]?.startsWith('|') && lines[i + 2] === l)
  const border = lines[start]
  if (!border) return undefined
  const bounds = bqCellBounds(border)
  const isRow = (l: string) => l.startsWith('|') && [...l].length === [...border].length
  const end = lines.findLastIndex(l => BQ_BORDER.test(l) || isRow(l))
  const [header, ...rows] = lines.slice(start, end + 1).filter(isRow).map(l => splitBqRow(l, bounds))
  if (!header) return undefined
  const notes = [...lines.slice(0, start), ...lines.slice(end + 1)].map(l => l.trim()).filter(Boolean)
  return { columns: header, rows: rows.map(r => r.map(c => (c === 'NULL' ? '∅' : c))), notes }
}

export const parseBqOutput = (stdout: string): Table | undefined => {
  const lines = stdout.split(/\r?\n|\r/).filter(l => !BQ_PROGRESS.test(l))
  return parseBqPretty(lines) ?? parseJsonRows(lines.join('\n'))
}

const QUOTED_ARGUMENT = /\s(["'])/g

const bqSql = (command: string, from: number): string | undefined => {
  QUOTED_ARGUMENT.lastIndex = from
  for (let match; (match = QUOTED_ARGUMENT.exec(command)); ) {
    const rest = command.slice(match.index + match[0].length)
    const end = rest.indexOf("'")
    const sql = match[1] === '"' ? unquoteDouble(rest) : end < 0 ? undefined : rest.slice(0, end)
    if (sql && SQL_START.test(sql)) return sql
  }
  return undefined
}

const withSql = (source: BashQuery['source'], sql: string | undefined): BashQuery => (sql ? { source, sql } : { source })

export const bashQueryOf = (command: string): BashQuery | undefined => {
  if (DBT_SHOW_COMMAND.test(command)) return withSql('dbt show', inlineDbtSql(command))
  const bq = BQ_QUERY_COMMAND.exec(command)
  return bq ? withSql('bq query', bqSql(command, bq.index + bq[0].length - 1)) : undefined
}

const MCP_QUERY_TOOLS: [server: RegExp, tool: RegExp, source: string][] = [
  [/bigquery/i, /^(execute_sql|execute_query|run_query|query)$/i, 'BigQuery'],
  [/dbt/i, /^show$/i, 'dbt show'],
  [/dbt/i, /^execute_sql$/i, 'dbt SQL'],
]

export const mcpQuerySource = (tool: string): string | undefined => {
  const split = tool.lastIndexOf('__')
  if (!tool.startsWith('mcp__') || split < 5) return undefined
  const server = tool.slice(5, split)
  const name = tool.slice(split + 2)
  return MCP_QUERY_TOOLS.find(([serverPattern, toolPattern]) => serverPattern.test(server) && toolPattern.test(name))?.[2]
}
