import type { Credential } from '../types'

export const LOGIN: Record<Credential, string> = {
  adc: 'gcloud auth application-default login',
  gcloud: 'gcloud auth login',
}

const REAUTH = /invalid_rapt|reauth related error|reauthentication (is )?(required|needed|failed)|invalid_grant/i
const GCLOUD_CLI = /(^|[^\w-])(bq|gcloud|gsutil)\s/
const ADC_CLI = /(^|[^\w-])dbt\s/
const LOGIN_COMMAND = /(^|[^\w-])gcloud\s+auth\s+(application-default\s+)?login(\s|$)/

export type Outcome = { credential: Credential; isExpired: boolean }

const credentialOfText = (text: string, fallback: Credential): Credential =>
  text.includes(LOGIN.adc) ? 'adc' : text.includes(LOGIN.gcloud) ? 'gcloud' : fallback

export const outcomeOf = (tool: string, command: string | undefined, text: string, isError: boolean): Outcome | undefined => {
  if (tool.startsWith('mcp__bigquery__')) return { credential: 'adc', isExpired: REAUTH.test(text) }
  if (tool !== 'Bash' || !command) return undefined
  const login = LOGIN_COMMAND.exec(command)
  if (login) return isError ? undefined : { credential: login[2] ? 'adc' : 'gcloud', isExpired: false }
  const fallback = GCLOUD_CLI.test(command) ? 'gcloud' : ADC_CLI.test(command) ? 'adc' : undefined
  if (!fallback) return undefined
  if (REAUTH.test(text)) return { credential: credentialOfText(text, fallback), isExpired: true }
  return isError ? undefined : { credential: fallback, isExpired: false }
}

export const nextExpired = (expired: readonly Credential[], { credential, isExpired }: Outcome): Credential[] =>
  isExpired ? [...new Set([...expired, credential])] : expired.filter(c => c !== credential)

export const statusOf = (expired: readonly Credential[]): string | undefined =>
  expired.length ? `GCP reauth needed: ${expired.map(c => `! ${LOGIN[c]}`).join(' · ')}` : undefined

export const modelNoteOf = (credential: Credential): string =>
  `Google Cloud ${credential === 'adc' ? 'application-default' : 'gcloud CLI'} credentials need reauthentication. ` +
  `Tell the user to run \`! ${LOGIN[credential]}\` before switching to another way of querying.`
