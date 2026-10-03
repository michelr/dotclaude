# query-table

A Claude Code mod that draws query results as aligned, colored tables in the transcript, with the SQL shown above them.

It handles two sources:

- **BigQuery MCP** — results of the `execute_sql` tool from an MCP server named `bigquery`
- **dbt show** — the box table printed by `dbt show` (dbt Fusion)

## What it looks like

```
╭───────────────────────────────────────────────────────────────╮
│ BigQuery · 2 rows · 3 columns                                 │
│ select                                                        │
│     report_date                                               │
│     , sum(amount) as amount                                   │
│ from `project.dataset.table`                                  │
│ group by 1                                                    │
│ ───────────────────────────────────────────────────────────── │
│ report_date │       amount │ user_id                          │
│ 2026-09-30  │ 1,234,567.89 │ 1234567                          │
│ 2026-10-01  │  -987,654.32 │       ∅                          │
╰───────────────────────────────────────────────────────────────╯
```

- The query as you wrote it, keeping your line breaks and indentation, colored as SQL
- Numbers right-aligned with thousand separators; negatives in red
- `id`, `*_id`, `*_key` and `*_year` columns keep their digits ungrouped
- Nulls shown as a dim `∅`
- At most 50 rows and 32 characters per cell; columns that don't fit the terminal are counted as hidden

## Requirements

- A Claude Code build with mod support (`claude plugin validate` and `claude plugin test` available)
- For BigQuery tables: an MCP server registered as `bigquery` that exposes `execute_sql`
- For dbt tables: dbt Fusion (the mod recognizes its `dbt-fusion` banner)

## Install

Clone the repo somewhere permanent:

```bash
git clone https://github.com/michelr/query-table.git ~/.claude/mods/query-table
```

Then load it in one of two ways.

**Every session** — add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/query-table"
  }
}
```

Separate several folders with `:` (`;` on Windows). This setting is read from your user settings only, not from a project's.

**One session** — pass the folder on the command line:

```bash
claude --plugin-dir ~/.claude/mods/query-table
```

In an interactive session the folder is watched: saving a file reloads the mod when the current turn ends.

## Usage

Nothing to run. Tables appear on their own when:

- the BigQuery `execute_sql` tool returns rows
- a Bash call runs `dbt show` and prints a table

For `dbt show`, the SQL header appears when the query is passed inline and quoted:

```bash
dbt show --inline "select ... from {{ ref('my_model') }}"
dbt show --inline='select ...'
```

With `--select my_model`, or SQL passed as `"$(cat file.sql)"`, the usual Bash row stays and the table is drawn below it without a header.

Running and failed calls are drawn by Claude Code as usual.

## Development

```bash
claude plugin validate .
npx -p typescript tsc -p .
claude plugin test .
```

The types the mod compiles against (`.claude-plugin/types/`) are written by Claude Code when it loads the mod and are not checked in. Load the mod once before running `tsc`.

| Path | What it holds |
| --- | --- |
| `hooks/register.tsx` | The render hooks and the table drawing |
| `hooks/parse.ts` | Parsing BigQuery and dbt output, SQL display, number formatting |
| `types/index.d.ts` | The session state the mod keeps (the inline SQL of each dbt show call) |
| `tests/` | Parse tests and render tests |

## Limitations

- dbt show prints a null and the string `"null"` the same way, so both show as `∅`
- A dbt query can't start with a `--` comment: dbt reads it as a flag
- dbt core output isn't recognized, only dbt Fusion's
- Queries longer than 10,000 characters are cut at that point
