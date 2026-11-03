#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

link() {
  local source="$1" target="$2"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    mv "$target" "$target.backup"
    echo "backed up $target to $target.backup"
  fi
  ln -sfn "$source" "$target"
  echo "linked $target -> $source"
}

mkdir -p "$HOME/.config/ccstatusline"
link "$repo/config/ccstatusline.json" "$HOME/.config/ccstatusline/settings.json"

claude plugin marketplace add "$repo"
for plugin in $(jq -r '.plugins[].name' "$repo/.claude-plugin/marketplace.json"); do
  claude plugin install "$plugin@dotclaude"
done
