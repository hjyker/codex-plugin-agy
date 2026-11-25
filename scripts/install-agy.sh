#!/usr/bin/env sh
set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PLUGIN_SRC="$REPO_DIR/plugins/codex"
PLUGIN_DST="${HOME}/.gemini/config/plugins/codex-plugin-agy"
BIN_DIR="${HOME}/.local/bin"
BIN_DST="${BIN_DIR}/codex-companion"

mkdir -p "$(dirname "$PLUGIN_DST")" "$BIN_DIR"

ln -sfn "$PLUGIN_SRC" "$PLUGIN_DST"

cat > "$BIN_DST" <<EOF
#!/usr/bin/env sh
export PATH="\$HOME/.local/bin:\$PATH"
: "\${CODEX_PLUGIN_DATA:=\$HOME/.codex-plugin-agy}"
export CODEX_PLUGIN_DATA
exec node "${PLUGIN_SRC}/scripts/codex-companion.mjs" "\$@"
EOF
chmod +x "$BIN_DST"

echo "Installed Antigravity plugin symlink: $PLUGIN_DST -> $PLUGIN_SRC"
echo "Installed global CLI launcher: $BIN_DST"
