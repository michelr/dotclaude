export type Alert = { id: string; summary: string; minutesLeft: number }

declare module 'claude-code' {
  interface PluginState {
    'meeting-reminder': { alert: Alert | null }
  }
}
