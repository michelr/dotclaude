# query-table

A Claude Code mod that draws query results as aligned, colored tables in the transcript, with the SQL shown above them.

It handles these sources:

- **BigQuery MCP** — the SQL tool (`execute_sql`, `execute_query`, `run_query` or `query`) of any MCP server with `bigquery` in its name, including the claude.ai Google Cloud BigQuery connector
- **dbt MCP** — the `show` and `execute_sql` tools of any MCP server with `dbt` in its name
- **dbt show** — the box table printed by `dbt show` (dbt Fusion, `dbt-fusion` or `dbt 2.x` banner)
- **bq CLI** — `bq query` output in the default `pretty` format, or `--format=json` / `prettyjson`

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
- For MCP tables: a BigQuery or dbt MCP server, under any name containing `bigquery` or `dbt`
- For dbt CLI tables: dbt Fusion (the mod recognizes its `dbt-fusion` or `dbt 2.x` banner)

## Install

query-table is part of the [dotclaude](https://github.com/michelr/dotclaude) marketplace:

```bash
claude plugin marketplace add michelr/dotclaude
claude plugin install query-table@dotclaude
```

## Usage

Nothing to run. Tables appear on their own when:

- a BigQuery MCP SQL tool or the dbt MCP `show` / `execute_sql` tool returns rows
- a Bash call runs `dbt show` and prints a table
- a Bash call runs `bq query` and prints a table

For `dbt show`, the SQL header appears when the query is passed inline and quoted:

```bash
dbt show --inline "select ... from {{ ref('my_model') }}"
dbt show --inline='select ...'
```

For `bq query`, the SQL header appears when the query is the quoted positional argument (`bq query --nouse_legacy_sql "select ..."`). Piping through `head` is fine; a `tail` that cuts off the column header leaves the output as plain text.

With `--select my_model`, SQL passed as `"$(cat file.sql)"`, or a `bq query` reading from stdin, the usual Bash row stays and the table is drawn below it without a header.

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
| `hooks/parse.ts` | Parsing BigQuery, dbt and bq output, SQL display, number formatting |
| `types/index.d.ts` | The session state the mod keeps (the source and inline SQL of each dbt show / bq query call) |
| `tests/` | Parse tests and render tests |

## Limitations

- dbt show prints a null and the string `"null"` the same way, so both show as `∅`; `bq` does the same with `NULL`
- A dbt query can't start with a `--` comment: dbt reads it as a flag
- dbt core output isn't recognized, only dbt Fusion's
- Queries longer than 10,000 characters are cut at that point
