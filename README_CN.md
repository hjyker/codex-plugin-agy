# Codex Plugin for Antigravity (`codex-plugin-agy`)

[English](./README.md) | 简体中文

将 OpenAI Codex 无缝接入 **Google Antigravity**（App 与 CLI）：在当前对话中直接调用 Codex 执行**只读代码审查**、**对抗式设计挑刺**、**疑难排错与任务委派**、**只读查阅 Codex 历史对话**，以及**跨端会话移交**。

> **特别致谢**
> 本项目基于 OpenAI 开源项目 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（Apache License 2.0）演进而来，现作为纯 Antigravity 原生插件独立维护。衷心感谢 OpenAI 团队在 `codex-companion` 运行时、`app-server` broker 架构、对抗式审查提示词与测试体系上的出色设计；完整 Apache-2.0 版权声明保留在 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE) 中。

---

## 核心能力

安装后，可在任意项目的 **Antigravity App** 或 **Antigravity CLI（`agy`）** 输入框中直接敲 `/` 调起全部 9 个斜杠命令：

- **`/codex-review`** — 标准只读代码审查（基于 Codex 原生 `review/start`）
- **`/codex-adversarial-review`** — 可引导的对抗式挑刺审查（质疑设计假设、边界、竞态与故障模式）
- **`/codex-rescue`** — 将复杂排错、修复或实现任务委派给 Codex（支持续跑线程、`codex://threads/<id>` deeplink、自定义模型、推理强度、沙箱与加速档）
- **`/codex-read`** — 通过只读 RPC 读取本地 Codex 对话历史（支持 `codex://threads/<id>` deeplink 或裸 UUID，零 token 消耗、不修改原线程）
- **`/codex-transfer`** — 将当前 Antigravity 对话上下文移交为持久化 Codex Thread，输出 `codex resume <session-id>`
- **`/codex-status`** — 查看当前仓库运行中与近期的 Codex 后台任务状态
- **`/codex-result`** — 查看已完成任务的完整原始输出与 `codex resume` 接管命令
- **`/codex-cancel`** — 中断并取消正在运行的后台 Codex 任务
- **`/codex-setup`** — 环境与登录态自检，以及开关可选的 `Stop` 自动审查门禁

---

## 环境要求

- **Google Antigravity**（App 或 CLI）
- **Node.js 18.18 或更高版本**
- **OpenAI Codex CLI**（已通过 ChatGPT 订阅或 OpenAI API Key 登录）：
  ```bash
  # macOS & Linux（官方独立安装脚本；重复执行即可更新）
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  codex login
  ```
  - Windows（PowerShell）：`powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`
  - 其他方式：`brew install --cask codex`（macOS）或 `npm install -g @openai/codex`

---

## 安装

本插件已实现 **100% 目录自包含**（全部脚本打包在 `plugins/codex/` 内，**不会**向 `~/.local/bin` 或系统 `PATH` 注入任何全局命令）。支持以下两种安装方式：

### 方式一：使用官方 Antigravity CLI（`agy`，推荐）

```bash
git clone https://github.com/hjyker/codex-plugin-agy.git
cd codex-plugin-agy

# 校验 manifest、hooks、skills 与 subagent
agy plugin validate ./plugins/codex

# 按官方规范安装到 ~/.gemini/config/plugins/
agy plugin install ./plugins/codex
agy plugin list
```

### 方式二：本地开发软链安装（仅装了 Antigravity App、未装 `agy` CLI 时）

```bash
# 克隆到一个长期保留的目录（软链会直接指向该目录）
git clone https://github.com/hjyker/codex-plugin-agy.git
cd codex-plugin-agy
./scripts/install-agy.sh
```

脚本仅创建一条软链 `~/.gemini/config/plugins/codex-plugin-agy` → `plugins/codex`（方便本地修改或 `git pull` 即时生效），不会往全局 `PATH` 写入任何文件。

安装完成后，在 Antigravity 中运行自检：

```text
/codex-setup
```

看到 `Status: ready` 即可开始使用。首次执行需要访问本机 `codex` 或网络的命令时，若 Antigravity 弹出权限确认，建议对该插件内置脚本路径 `<plugin-root>/scripts/codex-companion` 选择 **Always Allow**，既安全收敛权限边界，又能跨项目顺畅运行。

---

## 命令详解

### `/codex-review`

对当前工作区未提交改动或分支差异执行标准只读代码审查（不修改任何文件，不自动修复）。

- 支持参数：`[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--service-tier <fast|flex>]`
- 说明：底层映射至 Codex 原生 `review/start` RPC，不接收自定义 focus 文本或单次 `--effort`（推理强度遵循 Codex `config.toml`）；如需定向质疑或指定 `--effort`，请使用 `/codex-adversarial-review`。

```text
/codex-review
/codex-review --base main --wait
/codex-review --background --service-tier fast
```

### `/codex-adversarial-review`

发起可引导的**对抗式审查**（只读，不改代码），重点挑战实现方案、架构取舍、隐含假设、数据丢失、回滚与并发风险，返回结构化结论。

- 支持参数：`[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <fast|flex>] [focus ...]`

```text
/codex-adversarial-review
/codex-adversarial-review --base main --effort high --service-tier fast 重点排查并发锁与回滚边界
/codex-adversarial-review --background 质疑当前缓存与重试设计是否合理
```

### `/codex-rescue`

把疑难排错、根因分析、定点修复或独立开发任务委派给 Codex 执行，并保留持久化 Thread 以便多轮续跑或切去 Codex CLI/App 接管。

- 支持参数：`[--background|--wait] [--resume|--thread-id <id|codex://threads/<id>>|--fresh] [--sandbox read-only|workspace-write|danger-full-access] [--model <model>] [--effort <low|medium|high|xhigh|max|ultra>] [--service-tier <fast|flex>] [task]`
- 默认以可写模式（`workspace-write`）执行；仅做调研或只读诊断时可指定 `--sandbox read-only`；需调用宿主机 Docker 等环境时可指定 `--sandbox danger-full-access`。
- `--resume` 自动续跑当前仓库最近一次任务线程；多任务并行时可用 `--thread-id` 精确续跑指定线程（同时支持裸 ID 与 `codex://threads/<id>` deeplink）；`--fresh` 强制开启全新线程。
- 不传 `--model` / `--effort` 时沿用 Codex 默认配置；也可以指定本机 Codex CLI 支持的任意模型（如 `gpt-6.2-sol`、`gpt-6.2-astra`、`gpt-6.1-terra`、`gpt-6-luna`，具体可用模型与推理档位以当前账号与模型支持为准）。

```text
/codex-rescue 排查单测偶发失败的根因并给出最小安全修复
/codex-rescue --resume 按上述方案补齐边界单测
/codex-rescue --thread-id codex://threads/0195a3f0-0000-7000-8000-000000000001 --service-tier fast 继续完成剩余改造
/codex-rescue --model gpt-6.2-astra --effort high 诊断构建失败原因
/codex-rescue --background 重构认证中间件
```

### `/codex-read`

基于本地 `codex app-server` 原生只读 RPC 读取 Codex 历史对话（先调用 `thread/read` 获取元数据，再按 `historyMode` 自动通过 `thread/turns/list` + `thread/items/list` 分页拉取明细，并兼容旧版 `thread/read({ includeTurns: true })`）。**零 token 消耗、不会加载或修改原线程**。

- 支持参数：`<thread-id | codex://threads/<id>> [--limit <n>] [--all] [--include-tools] [--json]`
- 默认展示线程元数据 + 最近 10 轮（`--limit 10`）用户提问与 Codex 回复；`--all` 拉取全部轮次，`--include-tools` 附带命令执行、文件改动、推理摘要等明细，`--json` 输出结构化 JSON。
- 在普通对话中直接粘贴 `codex://threads/<id>` 让 Antigravity 帮着总结或分析方案时，也会自动触发此能力。

```text
/codex-read codex://threads/0195a3f0-0000-7000-8000-000000000001
/codex-read 0195a3f0-0000-7000-8000-000000000001 --limit 5 --include-tools
/codex-read codex://threads/0195a3f0-0000-7000-8000-000000000001 --all --json
```

### `/codex-transfer`

将当前 Antigravity 对话上下文整理移交为一个持久化 Codex Thread（只读握手轮，不会自动改文件或跑命令），输出 `codex resume <session-id>` 方便切到 Codex CLI 或 Codex App 亲自接手。

- 支持参数：`[--title <name>] [--model <model>]`

```text
/codex-transfer
/codex-transfer --title 支付回调幂等排查
```

### `/codex-status` / `/codex-result` / `/codex-cancel`

管理后台 Codex 任务队列与结果：

```text
/codex-status                  # 以紧凑表格查看当前仓库的活跃与近期任务
/codex-status <job-id>         # 查看单个任务完整进度与日志路径
/codex-result [job-id]         # 获取已完成任务的完整原始输出（含 codex resume 命令）
/codex-cancel [job-id]         # 发送 turn/interrupt 并中止正在运行的后台任务
```

### `/codex-setup`

检查本机 Node、npm、Codex CLI、登录态与运行状态，并可开关可选的 `Stop` 自动审查门禁：

```text
/codex-setup
/codex-setup --enable-review-gate
/codex-setup --disable-review-gate
```

> **提示**：开启 `--enable-review-gate` 后，每当 Antigravity 准备结束一轮代码修改回复时，`Stop` Hook 会自动触发一次只读 Codex 审查；若发现阻塞问题会返回 `decision: "continue"` 要求先修复再结束（内建 `continuationActive` 防死循环保护）。仅建议在主动盯盘时启用，用完及时关闭以节省额度。

---

## 核心设计亮点

1. **纯 Antigravity 原生插件结构**：根级 `plugins/codex/plugin.json`（含 `suggestedPrompts`）、根级 `plugins/codex/hooks.json`、9 个标准 `skills/codex-*/SKILL.md` 与 `agents/codex-rescue.md`。
2. **统一持久化状态目录**：通过 `CODEX_PLUGIN_DATA`（默认 `~/.codex-plugin-agy`，亦兼容 `PLUGIN_DATA`）让 Hooks、Antigravity `run_command` 与终端共享同一份状态与会话元数据。
3. **Broker 空闲自动回收**：`app-server-broker.mjs` 无活跃连接 20 分钟自动优雅退出（可通过 `CODEX_BROKER_IDLE_TIMEOUT_MS` 调整，设为 `0` 禁用），并提供 `codex-companion broker-stop` 手动停止命令。
4. **Antigravity Hook 协议**：`SessionStart` 与 `Stop` Hook 原生消费 Antigravity `camelCase` payload（`conversationId`、`transcriptPath`、`terminationReason`、`continuationActive`），输出标准 `{"decision": "continue"}` / `{}` 响应。
5. **只读对话读取与完整运行时控制**：内置 `/codex-read`（`codex://threads/<id>` deeplink 解析 + 零 token 只读 RPC）、`--sandbox`、`--effort max|ultra`、`--service-tier`、`--thread-id`、`adversarial-review --effort`、Antigravity 上下文 `transfer` 移交、5 分钟心跳进度汇报与返工熔断护栏。

---

## 本地状态目录与常见问题

### `~/.codex-plugin-agy` 是什么？

`~/.codex-plugin-agy` 是本插件的**运行时状态与任务缓存目录**（并非插件安装目录，也不会向 `PATH` 注入任何可执行文件）。内置脚本 `codex-companion` 与 `hooks.json` 默认按以下优先级解析状态根目录：`CODEX_PLUGIN_DATA` → `PLUGIN_DATA` → `~/.codex-plugin-agy`。

在 `~/.codex-plugin-agy/state/<仓库名>-<hash>/` 下，按每个 Git 仓库分别保存：
- `state.json`：该仓库的 `stopReviewGate` 开关状态，以及最近最多 50 条任务索引（供 `/codex-status`、`/codex-result`、`/codex-cancel` 与 `--resume` 查询）。
- `jobs/`：每个任务的存储输出 `.json` 与进度日志 `.log`（超过 50 条旧记录会自动裁剪清理）。
- `broker.json`：共享 `codex app-server` broker 的本地 socket 端点与 PID（空闲 20 分钟自动退出后清理）。
- `session.json`：`SessionStart` Hook 记录的当前 Antigravity 会话 ID 与 transcript 路径（供 `/codex-transfer` 自动提取上下文）。

**补充说明：**
- **不是 Codex 真正的对话历史**：Codex 自己的对话数据存放在 `~/.codex/` 中。随时删除 `~/.codex-plugin-agy` 只会清空插件任务历史与 review-gate 开关，**不会**影响任何 Codex 对话。
- **与 `codex-plugin-cc` 的关系**：原版 `codex-plugin-cc` 使用完全相同的按仓库 `state/` 持久化机制，区别仅在于 Claude Code 宿主会自动注入 `CLAUDE_PLUGIN_DATA`（落盘在 `~/.claude/plugins/data/` 下）；由于 Antigravity 的 `run_command` 不会自动注入插件数据目录变量，因此本插件默认落盘到 `~/.codex-plugin-agy`，确保 Hooks、AGY 工具调用与终端手动执行共享同一份状态。
- **自定义目录**：如果你不希望在 `~/` 根目录保留该目录，可在 shell 配置中设置 `CODEX_PLUGIN_DATA` 覆盖（例如 `export CODEX_PLUGIN_DATA="$HOME/.gemini/plugin-data/codex-plugin-agy"` 或 `"$HOME/.cache/codex-plugin-agy"`）。

### 为什么命令是 `/codex-status` 而不是 `/codex:status`？

Antigravity 的斜杠命令直接对应 `skills/<name>/SKILL.md` 中的 `name` 字段（官方规范为小写连字符 kebab-case），不会像 Claude Code 那样自动拼接 `plugin:` 冒号命名空间，因此全部 9 个命令统一使用 `/codex-*` 前缀。

### `/codex-read` 会消耗 token 或改动原 Codex 对话吗？

不会。`/codex-read` 仅调用本地 `codex app-server` 的只读 RPC（`thread/read`、`thread/turns/list`、`thread/items/list`）读取本地持久化记录，**零 token 消耗**，且不会加载、续跑或修改原线程状态。

---

## 常用配置与运维

插件直接调用本机 `codex app-server`，自动继承你的本机登录态与以下配置：
- 用户级配置：`~/.codex/config.toml`
- 项目级覆写：`<repo>/.codex/config.toml`（项目被信任时生效）

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `CODEX_PLUGIN_DATA` | `~/.codex-plugin-agy` | 插件状态、任务记录与日志根目录 |
| `CODEX_BROKER_IDLE_TIMEOUT_MS` | `1200000`（20 分钟） | 共享 `app-server` broker 空闲自动退出时长（毫秒，`0` 表示不自动退出） |

### 运行测试与版本校验

```bash
node --test tests/*.test.mjs
npm run check-version
```

---

## 开源协议与致谢

本项目采用 **Apache License 2.0** 协议，详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。衍生自 OpenAI 官方开源项目 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)。
