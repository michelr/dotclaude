export type Credential = 'adc' | 'gcloud'

declare module 'claude-code' {
  interface PluginState {
    'gcp-reauth': { expired: Credential[] }
  }
}
