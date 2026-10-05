import type { Register } from 'claude-code'

import { LOGIN, modelNoteOf, nextExpired, outcomeOf, statusOf } from './detect'

const EXPIRED = { plugin: 'gcp-reauth', key: 'expired' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { value = [] } = await $.state.get(EXPIRED)
    $.ui.status(statusOf(value))
    return next(e)
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
