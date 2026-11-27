# Changelog

## 1.0.6

- Native Google Antigravity plugin (`codex-plugin-agy`) derived from `openai/codex-plugin-cc` (Apache-2.0).
- Added `/codex-read` read-only thread inspection with `codex://threads/<id>` deeplink support (zero token cost, supports both paginated and legacy history modes).
- Self-contained plugin runtime (`plugins/codex/scripts/codex-companion`), root `plugin.json` and `hooks.json`, automatic broker idle shutdown, and Antigravity session handoff (`/codex-transfer`).
