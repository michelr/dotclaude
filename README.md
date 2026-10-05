# dotclaude

My Claude Code setup in one place: mods, skills and plugins, published as a plugin marketplace, plus config files that aren't plugins.

## Contents

| Path | What it is |
| --- | --- |
| [`plugins/query-table`](plugins/query-table) | Mod: draws BigQuery MCP, `bq query` and `dbt show` results as colored tables |
| [`plugins/gcp-reauth`](plugins/gcp-reauth) | Mod: flags expired Google Cloud credentials with the login command to run |
| [`config/statusline.sh`](config/statusline.sh) | Status line: model, folder, git branch, cost and context use |

## Install

```bash
git clone https://github.com/michelr/dotclaude.git ~/Documents/dotclaude
~/Documents/dotclaude/install.sh
```

`install.sh` links the config files into `~/.claude` (backing up any file already there), adds this folder as the `dotclaude` marketplace, and installs every plugin in it. The status line also needs `"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }` in `~/.claude/settings.json`.

Because the marketplace is a local folder, plugins are read straight from the clone: edit a file, then run `/reload-plugins`. No reinstall or version bump needed.

To install a plugin without cloning:

```bash
claude plugin marketplace add michelr/dotclaude
claude plugin install query-table@dotclaude
```

## Adding something

- **Mod or skill:** add a folder under `plugins/<name>/` with a `.claude-plugin/plugin.json` (skills go in `plugins/<name>/skills/<skill>/SKILL.md`), then list it in `.claude-plugin/marketplace.json`
- **Config file:** add it under `config/` and add a `link` line to `install.sh`
