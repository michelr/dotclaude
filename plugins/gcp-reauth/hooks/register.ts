import type { Register } from 'claude-code'

import type { Credential } from '../types'

import { LOGIN, modelNoteOf, nextExpired, outcomeOf, PROBE, probeOutcomeOf, statusOf } from './detect'

const EXPIRED = { plugin: 'gcp-reauth', key: 'expired' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { value = [] } = await $.state.get(EXPIRED)
    $.ui.status(statusOf(value))
    const started = await next(e)
    void (async () => {
      const outcomes = await Promise.all(
        (Object.keys(PROBE) as Credential[]).map(credential =>
          $.process
            .run(PROBE[credential], { timeoutMs: 15000 })
            .then(({ exitCode, stderr }) => probeOutcomeOf(credential, exitCode, stderr))
            .catch(() => undefined),
        ),
      )
      const { value: expired = [] } = await $.state.get(EXPIRED)
      const updated = outcomes.reduce((acc, outcome) => (outcome ? nextExpired(acc, outcome) : acc), expired)
      await $.state.set(EXPIRED, updated)
      $.ui.status(statusOf(updated))
      if (updated.length) $.ui.toast(`GCP credentials expired: run ${updated.map(c => `! ${LOGIN[c]}`).join(' and ')}`, { timeoutMs: 10000 })
    })()
    return started
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const command = e.tool === 'Bash' ? e.command : undefined
    const outcome = outcomeOf(e.tool, command, ran.text ?? '', ran.isError === true)
    if (!outcome) return ran

    const { value: expired = [] } = await $.state.get(EXPIRED)
    const updated = nextExpired(expired, outcome)
    if (updated.length !== expired.length) {
      await $.state.set(EXPIRED, updated)
      $.ui.status(statusOf(updated))
      $.ui.toast(
        outcome.isExpired ? `GCP credentials expired: run ! ${LOGIN[outcome.credential]}` : 'GCP credentials restored',
        { timeoutMs: outcome.isExpired ? 10000 : 4000 },
      )
    }
    return outcome.isExpired ? { ...ran, context: [...(ran.context ?? []), modelNoteOf(outcome.credential)] } : ran
  })
}
