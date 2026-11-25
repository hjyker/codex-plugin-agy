# Codex Plugin for Antigravity (`codex-plugin-agy`)

[English](./README.md) | 简体中文

将 OpenAI Codex 无缝接入 **Google Antigravity**（App 与 CLI）：在当前对话中直接调用 Codex 执行**只读代码审查**、**对抗式设计挑刺**、**疑难排错与任务委派**、以及**跨端会话移交**。

> **上游说明与致谢**
> 本项目基于 OpenAI 官方开源插件 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（Apache License 2.0）进行 Antigravity 原生适配。衷心感谢 OpenAI 团队打造的 `codex-companion` 运行时、`app-server` broker 架构、对抗式审查提示词与完整测试体系。本仓库保留上游兼容结构与 Apache-2.0 版权声明（[LICENSE](./LICENSE)、[NOTICE](./NOTICE)），便于后续持续同步上游更新。

---

## 核心能力

安装后，可在任意项目的 **Antigravity App** 或 **Antigravity CLI（`agy`）** 输入框中直接敲 `/` 调起全部 8 个斜杠命令：

- **`/codex-review`** — 标准只读代码审查（基于 Codex 原生 `review/start`）
- **`/codex-adversarial-review`** — 可引导的对抗式挑刺审查（质疑设计假设、边界、竞态与故障模式）
- **`/codex-rescue`** — 将复杂排错、修复或实现任务委派给 Codex（支持续跑线程、自定义模型、推理强度、沙箱与加速档）
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
  npm install -g @openai/codex
  codex login
  ```

---

## 安装

克隆仓库并运行一键安装脚本：

```bash
git clone https://github.com/hjyker/codex-plugin-agy.git /opt/life/codex-plugin-agy
cd /opt/life/codex-plugin-agy
./scripts/install-agy.sh
```

脚本会自动完成两项全局安装（跨所有项目生效）：
1. 创建插件软链：`~/.gemini/config/plugins/codex-plugin-agy` → `plugins/codex`
2. 安装全局 CLI 入口：`~/.local/bin/codex-companion`（自动统一 `CODEX_PLUGIN_DATA=~/.codex-plugin-agy` 与 `PATH`，确保 Hooks 与命令行共享同一份状态目录）

> 请确保 `~/.local/bin` 已在你的 `PATH` 环境变量中。

安装完成后，在 Antigravity 中运行自检：

```text
/codex-setup
```

看到 `Status: ready` 即可开始使用。首次执行需要访问本机 `codex` 或网络的命令时，若 Antigravity 弹出权限确认，建议对 `codex-companion` 前缀选择 **Always Allow**，后续所有项目均可顺畅运行。

---

## 命令详解

### `/codex-review`

对当前工作区未提交改动或分支差异执行标准只读代码审查（不修改任何文件，不自动修复）。

- 支持参数：`[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--service-tier <tier>]`
- 说明：底层映射至 Codex 原生 `review/start` RPC，不接收自定义 focus 文本或单次 `--effort`（推理强度遵循 Codex `config.toml`）；如需定向质疑或指定 `--effort`，请使用 `/codex-adversarial-review`。

```text
/codex-review
/codex-review --base main --wait
/codex-review --background --service-tier fast
```

### `/codex-adversarial-review`

发起可引导的**对抗式审查**（只读，不改代码），重点挑战实现方案、架构取舍、隐含假设、数据丢失、回滚与并发风险，返回结构化结论。

- 支持参数：`[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort <none|minimal|low|medium|high|xhigh|max|ultra>] [--service-tier <tier>] [focus ...]`

```text
/codex-adversarial-review
/codex-adversarial-review --base main --effort high --service-tier fast 重点排查并发锁与回滚边界
/codex-adversarial-review --background 质疑当前缓存与重试设计是否合理
```

### `/codex-rescue`

把疑难排错、根因分析、定点修复或独立开发任务委派给 Codex 执行，并保留持久化 Thread 以便多轮续跑或切去 Codex CLI/App 接管。

- 支持参数：`[--background|--wait] [--resume|--thread-id <id>|--fresh] [--sandbox read-only|workspace-write|danger-full-access] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh|max|ultra>] [--service-tier <tier>] [task]`
- 默认以可写模式（`workspace-write`）执行；仅做调研或只读诊断时可指定 `--sandbox read-only`；需调用宿主机 Docker 等环境时可指定 `--sandbox danger-full-access`。
- `--resume` 自动续跑当前仓库最近一次任务线程；多任务并行时可用 `--thread-id <id>` 精确续跑指定线程；`--fresh` 强制开启全新线程。
- `--model spark` 自动映射为 `gpt-5.3-codex-spark`；不传 `--model` / `--effort` 时沿用 Codex 默认配置。

```text
/codex-rescue 排查单测偶发失败的根因并给出最小安全修复
/codex-rescue --resume 按上述方案补齐边界单测
/codex-rescue --thread-id thr_xxx --service-tier fast 继续完成剩余改造
/codex-rescue --model gpt-5.4-mini --effort medium 诊断构建失败原因
/codex-rescue --background 重构认证中间件
```

### `/codex-transfer`

将当前 Antigravity 对话上下文整理移交为一个持久化 Codex Thread（只读握手轮，不会自动改文件或跑命令），输出 `codex resume <session-id>` 方便切到 Codex CLI 或 Codex App 亲自接手。

- 支持参数：`[--title <name>] [--model <model>] [--source <claude-jsonl>]`
- 如传入 `--source ~/.claude/projects/.../*.jsonl`，仍保留上游对 Claude Code 原生会话导入的兼容。

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

## 相比 `codex-plugin-cc` 的 Antigravity 适配点

1. **原生插件结构**：新增根级 `plugins/codex/plugin.json`（含 `suggestedPrompts`）及根级 `plugins/codex/hooks.json`，并将 8 个命令转为标准 `skills/codex-*/SKILL.md` 与适配后的 `agents/codex-rescue.md`。
2. **统一持久化状态目录**：摆脱对 Claude Code 专属 `CLAUDE_ENV_FILE` 的依赖，通过 `CODEX_PLUGIN_DATA`（默认 `~/.codex-plugin-agy`）让 Hooks、Antigravity `run_command` 与终端共享同一份状态与会话元数据。
3. **Broker 空闲自动回收**：针对 Antigravity 无 `SessionEnd` 事件的特点，为 `app-server-broker.mjs` 增加无活跃连接 20 分钟自动优雅退出（可通过 `CODEX_BROKER_IDLE_TIMEOUT_MS` 调整，设为 `0` 禁用），并提供 `codex-companion broker-stop` 手动停止命令。
4. **AGY Hook 协议兼容**：`SessionStart` 与 `Stop` Hook 兼容 Antigravity `camelCase` payload（`conversationId`、`transcriptPath`、`terminationReason`、`continuationActive`），`Stop` 阻断输出符合 AGY 规范的 `{"decision": "continue"}`。
5. **通用参数与长任务体验增强**：补齐 `--sandbox`、`--effort max|ultra`、`--service-tier`、`--thread-id`、`adversarial-review --effort`、AGY 上下文 `transfer` 移交，以及 5 分钟心跳进度汇报与返工熔断护栏。

---

## 常用配置与运维

插件直接调用本机 `codex app-server`，自动继承你的本机登录态与以下配置：
- 用户级配置：`~/.codex/config.toml`
- 项目级覆写：`<repo>/.codex/config.toml`（项目被信任时生效）

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `CODEX_PLUGIN_DATA` | `~/.codex-plugin-agy` | 插件状态、任务记录与日志根目录 |
| `CODEX_BROKER_IDLE_TIMEOUT_MS` | `1200000`（20 分钟） | 共享 `app-server` broker 空闲自动退出时长（毫秒，`0` 表示不自动退出） |

### 运行测试

```bash
node --test tests/*.test.mjs
```

### 同步上游 `openai/codex-plugin-cc`

```bash
git fetch upstream
git merge upstream/main
node --test tests/*.test.mjs
```

---

## 开源协议与致谢

本项目采用 **Apache License 2.0** 协议，详见 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE)。衍生自 OpenAI 官方开源项目 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)。
