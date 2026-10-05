export type BashQuery = { source: 'dbt show' | 'bq query'; sql?: string }

declare module 'claude-code' {
  interface PluginState {
    'query-table': { bashQuery: StateFamily<BashQuery> }
  }
}
