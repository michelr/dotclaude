import { expect, test } from 'claude-code/testing'
import { parseEvents } from '../hooks/register'

test('declined, cancelled and all-day events are dropped and the rest sorted', () => {
  const text = JSON.stringify({
    events: [
      { id: 'b', summary: 'Later', status: 'confirmed', start: { dateTime: '2026-11-03T14:00:00+01:00' } },
      { id: 'a', summary: 'Sooner', status: 'confirmed', start: { dateTime: '2026-11-03T10:00:00+01:00' } },
      { id: 'c', summary: 'Declined', start: { dateTime: '2026-11-03T11:00:00+01:00' }, attendees: [{ self: true, responseStatus: 'declined' }] },
      { id: 'd', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-11-03T12:00:00+01:00' } },
      { id: 'e', summary: 'All day', start: { date: '2026-11-03' } },
    ],
  })
  expect(parseEvents(text).map(e => e.id)).toEqual(['a', 'b'])
})
