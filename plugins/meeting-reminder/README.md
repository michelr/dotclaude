# meeting-reminder

A Claude Code mod that warns you before a Google Calendar meeting so you don't miss it while coding.

## What it does

At session start it reads your next 7 days of events through the `claude.ai Google Calendar` MCP connector, refetches every 15 minutes and checks once a minute.

- The status line always shows the next meeting: `next: Tennis 12:45`
- Five minutes before a meeting: a yellow band above the prompt that counts down, a toast, and a native notification through your terminal's notification channel
- The band clears when the meeting starts, when you press `1` or click Dismiss, or when you send a prompt
- Declined, cancelled and all-day events are ignored

`/meetings` lists your next 5 events and fires a fake "Test meeting" reminder through all three channels.

## Setup

The calendar call runs from a timer, not a model turn, so under auto mode it needs a standing allow rule in `~/.claude/settings.json`:

```json
"permissions": { "allow": ["mcp__claude_ai_Google_Calendar__list_events"] }
```

Without it the status line reads `calendar unavailable` and `/meetings` prints the refusal.

## Limitations

- Only the primary calendar
- The notification goes through `preferredNotifChannel`; a terminal that drops it shows the band and toast only

## Development

```bash
claude plugin validate .
npx -p typescript tsc -p .
claude plugin test .
```
