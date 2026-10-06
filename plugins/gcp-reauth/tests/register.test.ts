import { expect, mock, test } from 'claude-code/testing'

const RAPT = 'auth: cannot fetch token: 400 {"error": "invalid_grant", "error_subtype": "invalid_rapt"}'

test('an expired call shows the login, tells the model, and a later success clears it', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e, next) => (statuses.push(e.text), next(e)))
  on('ui.toast', ($, e, next) => (toasts.push(e.text), next(e)))
  let answer: { text: string; isError: boolean } = { text: RAPT, isError: true }
  on('tool.call', () => ({ result: answer.text, text: answer.text, ...(answer.isError ? { isError: true } : {}) }) as never)

  const failed = await $.tool.call({ tool: 'mcp__bigquery__execute_sql', sql: 'select 1' } as never)
  expect(failed.context?.join('\n')).toMatch(/gcloud auth application-default login/)
  expect(statuses.at(-1)).toBe('GCP reauth needed: ! gcloud auth application-default login')
  expect(toasts).toEqual(['GCP credentials expired: run ! gcloud auth application-default login'])

  await $.tool.call({ tool: 'mcp__bigquery__execute_sql', sql: 'select 1' } as never)
  expect(toasts).toHaveLength(1)

  answer = { text: '[{"n":"1"}]', isError: false }
  const ok = await $.tool.call({ tool: 'mcp__bigquery__execute_sql', sql: 'select 1' } as never)
  expect(ok.context).toBeUndefined()
  expect(statuses.at(-1)).toBeUndefined()
  expect(toasts.at(-1)).toBe('GCP credentials restored')
})

test('session start probes both logins and flags the expired one', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', ($, e, next) => (statuses.push(e.text), next(e)))
  on('ui.toast', ($, e, next) => (toasts.push(e.text), next(e)))
  on('session.start', ($, e) => e as never)
  const clock = mock.clock(on)
  on('process.run', ($, e) => {
    const isAdc = e.argv.includes('application-default')
    return {
      value: {
        exitCode: isAdc ? 1 : 0,
        stdout: '',
        stderr: isAdc ? 'Reauthentication failed.' : '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()

  expect(statuses.at(-1)).toBe('GCP reauth needed: ! gcloud auth application-default login')
  expect(toasts).toEqual(['GCP credentials expired: run ! gcloud auth application-default login'])
})
