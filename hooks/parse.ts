export type Table = { columns: string[]; rows: string[][]; notes: string[] }

const NUMERIC = /^-?\d[\d,]*\.?\d*(e[+-]?\d+)?$/i
const DBT_ROW = /^│(.*)│$/
const DBT_BORDER = /^[┌╞├└]/
const DBT_BANNER = /^\s*dbt-fusion /
const DBT_TRAILING_DOT = /^-?\d[\d,]*\.$/

export const isNumeric = (value: string): boolean => NUMERIC.test(value.trim())

const textOf = (output: unknown): string | undefined => {
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

const recordsOf = (text: string): Record<string, unknown>[] | undefined => {
  const whole = tryJson(text.trim())
  if (isRecordArray(whole)) return whole
  if (isRecord(whole)) {
    const values = Object.values(whole)
    return values.length === 1 && isRecordArray(values[0]) ? values[0] : [whole]
  }
  const objects = splitConcatenatedObjects(text).map(tryJson)
  return objects.length && objects.every(isRecord) ? (objects as Record<string, unknown>[]) : undefined
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
    .filter(l => l && !/^(dbt-fusion|Loading |Query show_sql|\d+ rows?\.|=+ .* =+$)/.test(l))
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
