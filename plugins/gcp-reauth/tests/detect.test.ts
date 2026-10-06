import { expect, test } from 'claude-code/testing'

import { nextExpired, outcomeOf, probeOutcomeOf, statusOf } from '../hooks/detect'

const RAPT = 'auth: cannot fetch token: 400\nResponse: {"error": "invalid_grant", "error_subtype": "invalid_rapt"}'

test('a BigQuery MCP reauth error expires the application-default login', () => {
  expect(outcomeOf('mcp__bigquery__execute_sql', undefined, RAPT, true)).toEqual({ credential: 'adc', isExpired: true })
  expect(outcomeOf('mcp__bigquery__execute_sql', undefined, '[{"n":"1"}]', false)).toEqual({ credential: 'adc', isExpired: false })
})

test('a bq reauth error expires the gcloud login, unless the text names the other one', () => {
  expect(outcomeOf('Bash', 'bq query "select 1"', 'Reauthentication required.', true)).toEqual({ credential: 'gcloud', isExpired: true })
  expect(outcomeOf('Bash', 'uv run dbt show --inline "select 1"', RAPT, true)).toEqual({ credential: 'adc', isExpired: true })
  expect(outcomeOf('Bash', 'bq ls', 'Reauthentication required. Run gcloud auth application-default login', true)).toEqual({ credential: 'adc', isExpired: true })
})

test('a successful login or query restores its credential', () => {
  expect(outcomeOf('Bash', 'gcloud auth application-default login', 'Credentials saved', false)).toEqual({ credential: 'adc', isExpired: false })
  expect(outcomeOf('Bash', 'gcloud auth login', 'You are now logged in', false)).toEqual({ credential: 'gcloud', isExpired: false })
  expect(outcomeOf('Bash', 'bq query "select 1"', '| 1 |', false)).toEqual({ credential: 'gcloud', isExpired: false })
})

test('ignores unrelated commands and failures that are not about auth', () => {
  expect(outcomeOf('Bash', 'grep -r invalid_rapt notes/', RAPT, false)).toBeUndefined()
  expect(outcomeOf('Bash', 'bq query "selec 1"', 'Syntax error', true)).toBeUndefined()
  expect(outcomeOf('Read', undefined, RAPT, false)).toBeUndefined()
})

test('tracks each expired credential once and names its login in the status', () => {
  const both = nextExpired(nextExpired(['adc'], { credential: 'adc', isExpired: true }), { credential: 'gcloud', isExpired: true })
  expect(both).toEqual(['adc', 'gcloud'])
  expect(statusOf(both)).toBe('GCP reauth needed: ! gcloud auth application-default login · ! gcloud auth login')
  expect(statusOf(nextExpired(['adc'], { credential: 'adc', isExpired: false }))).toBeUndefined()
})

test('a token probe expires on a reauth error, restores on success, and ignores other failures', () => {
  const reauth = 'There was a problem refreshing your current auth tokens: Reauthentication failed.'
  expect(probeOutcomeOf('gcloud', 1, reauth)).toEqual({ credential: 'gcloud', isExpired: true })
  expect(probeOutcomeOf('adc', 0, '')).toEqual({ credential: 'adc', isExpired: false })
  expect(probeOutcomeOf('adc', 1, 'Unable to reach oauth2.googleapis.com')).toBeUndefined()
})
