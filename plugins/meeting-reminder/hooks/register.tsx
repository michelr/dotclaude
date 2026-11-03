import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Alert } from '../types'

const LEAD_MS = 5 * 60_000
const TICK_MS = 60_000
const REFRESH_MS = 15 * 60_000

type Event = { id: string; summary: string; startsAt: number }

type RawEvent = {
  id: string
  summary?: string
  status?: string
  start?: { dateTime?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

export const parseEvents = (text: string): Event[] => {
  const raw: RawEvent[] = JSON.parse(text).events ?? []
  return raw
    .filter(e => e.start?.dateTime && e.status !== 'cancelled')
    .filter(e => !e.attendees?.some(a => a.self && a.responseStatus === 'declined'))
    .map(e => ({ id: e.id, summary: e.summary ?? '(no title)', startsAt: Date.parse(e.start!.dateTime!) }))
    .sort((a, b) => a.startsAt - b.startsAt)
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
const day = (ms: number) => new Date(ms).toDateString().slice(0, 3)
const alert = atom({ plugin: 'meeting-reminder', key: 'alert' } as const, null)

const raise = async ($: EngineInterface, next: Alert) => {
  await update($, alert, () => next)
  $.ui.toast(`Meeting in ${next.minutesLeft} min: ${next.summary}`, { timeoutMs: 60_000 })
  await $.ui.notify(`${next.summary} starts in ${next.minutesLeft} min`, { title: 'Meeting' }).catch(() => undefined)
}

export const register: Register = on => {
  let events: Event[] = []
  let lastError = ''
  const notified = new Set<string>()
  let refetch: () => Promise<void> = async () => undefined

  on('command.run', { command: 'meetings' }, async $ => {
    await refetch()
    await raise($, { id: 'test', summary: 'Test meeting', minutesLeft: 5 })
    const lines = events.slice(0, 5).map(ev => `${day(ev.startsAt)} ${clock(ev.startsAt)} ${ev.summary}`)
    return { text: lines.length ? lines.join('\n') : `No upcoming events. ${lastError}`.trim() }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, alert, () => null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, alert)
    if (e.props.hasSurvey || current === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box borderStyle="round" borderColor="warning" paddingX={1}>
        <Text color="warning" bold>
          ⏰ {current.summary} in {current.minutesLeft} min{' '}
        </Text>
        <Button key="dismiss" label="Dismiss" hotkey="1" plain onPress={() => update($, alert, () => null)} />
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)
    await $.command.register({ name: 'meetings', description: 'List upcoming meetings and fire a test reminder' })

    const refresh = async () => {
      const { content, isError } = await $.mcp.call('claude.ai Google Calendar', 'list_events', {
        orderBy: 'startTime',
        pageSize: 50,
      })
      const text = content.find(b => b.type === 'text')?.text
      if (isError || !text) {
        lastError = `calendar error: ${text ?? 'no text block'}`.slice(0, 300)
        return $.ui.status('calendar unavailable')
      }
      events = parseEvents(text)
    }

    const tick = async () => {
      const now = await $.clock.now()
      events = events.filter(ev => ev.startsAt > now - TICK_MS)
      const upcoming = events[0]
      $.ui.status(upcoming ? `next: ${upcoming.summary} ${clock(upcoming.startsAt)}` : undefined)
      const current = await read($, alert)
      if (current && !events.some(ev => ev.id === current.id) && current.id !== 'test') await update($, alert, () => null)
      for (const ev of events) {
        const minutesLeft = Math.max(0, Math.round((ev.startsAt - now) / 60_000))
        if (ev.startsAt - now > LEAD_MS) continue
        if (notified.has(ev.id)) {
          if (current?.id === ev.id) await update($, alert, () => ({ ...current, minutesLeft }))
          continue
        }
        notified.add(ev.id)
        await raise($, { id: ev.id, summary: ev.summary, minutesLeft })
      }
    }

    refetch = async () => {
      lastError = ''
      await refresh().catch(err => {
        lastError = `calendar error: ${String(err)}`.slice(0, 300)
        $.ui.status('calendar unavailable')
      })
      await tick()
    }
    await refetch()
    $.clock.every(TICK_MS, tick)
    $.clock.every(REFRESH_MS, refetch)

    return next(e)
  })
}
