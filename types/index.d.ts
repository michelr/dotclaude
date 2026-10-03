export type DbtSql = string

declare module 'claude-code' {
  interface PluginState {
    'query-table': { dbtSql: StateFamily<DbtSql> }
  }
}
