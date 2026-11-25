#!/usr/bin/env sh
set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PLUGIN_SRC="$REPO_DIR/plugins/codex"
PLUGIN_DST="${HOME}/.gemini/config/plugins/codex-plugin-agy"

chmod +x "${PLUGIN_SRC}/scripts/codex-companion"
mkdir -p "$(dirname "$PLUGIN_DST")"
ln -sfn "$PLUGIN_SRC" "$PLUGIN_DST"

echo "Installed Antigravity plugin symlink: $PLUGIN_DST -> $PLUGIN_SRC"
echo "Self-contained runtime entrypoint: $PLUGIN_DST/scripts/codex-companion (no global PATH binary injected)"
