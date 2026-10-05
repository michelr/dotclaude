#!/bin/bash
input=$(cat)

# Parse JSON input
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
DIR=$(echo "$input" | jq -r '.workspace.current_dir // "~"')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
TOKENS=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
PERCENT=$(echo "$input" | jq -r '.context_window.used_percentage // 0')

# Get git branch if in a repo
BRANCH=""
if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    # Check for uncommitted changes
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        BRANCH="${BRANCH}*"
    fi
fi

# Format directory (show last component)
DIR_NAME="${DIR##*/}"

# Format cost
COST_FMT=$(printf "%.2f" "$COST")

# Format tokens (K for thousands)
if [ "$TOKENS" -ge 1000 ]; then
    TOKENS_FMT="$(echo "scale=1; $TOKENS/1000" | bc)K"
else
    TOKENS_FMT="$TOKENS"
fi

# Format percentage
PERCENT_FMT=$(printf "%.0f" "$PERCENT")

# Build output with colors
# Colors: \033[36m = cyan, \033[33m = yellow, \033[32m = green, \033[35m = magenta, \033[0m = reset
OUTPUT="\033[36m${MODEL}\033[0m"
OUTPUT+=" \033[33m${DIR_NAME}\033[0m"

if [ -n "$BRANCH" ]; then
    OUTPUT+=" \033[35m${BRANCH}\033[0m"
fi

OUTPUT+=" \033[32m\$${COST_FMT}\033[0m"
OUTPUT+=" ${TOKENS_FMT} (${PERCENT_FMT}%)"

echo -e "$OUTPUT"
