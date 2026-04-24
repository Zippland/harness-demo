# Harness

基于控制论的 AI 对抗式长时任务执行系统。

Interrogator 先和用户澄清意图,然后 Generator ↔ Evaluator 在每个 Sprint 里协商计划、实现功能、独立审查,直到双方对结果满意。详见 [`docs/SPEC.md`](./docs/SPEC.md)。

## 安装

```bash
git clone https://github.com/Zippland/harness-demo.git
cd harness-demo
npm install
npm link
```

安装后 `harness` 命令全局可用。

## 前置条件

- Node.js >= 18
- Claude Code CLI 已安装并登录(`claude` 命令可用)

## 使用

```bash
# 语法糖:discover + execute 一口气跑完
harness "构建一个 URL 解析库"

# 只做 discovery,产出 pending task(discover 完可以去睡觉,稍后再 execute)
harness discover "构建一个 URL 解析库"

# 执行:自动选 in-progress(断点恢复),否则最新 pending
harness execute

# 执行指定 task
harness execute task-1730000000

# 熟练用户:跳过 inquiry
harness execute --direct "明确无歧义的小功能"

# 无参数:断点恢复 in-progress,否则列 pending
harness

# 重置所有进度
npm run reset
```

## 工作目录结构

所有任务状态在运行目录下的 `.harness/` 里,**每个 task 完整隔离**:

```
.harness/
├── config.json                    # 可选:项目级配置
├── golden-principles.md           # 可选:项目级质量标准覆盖
└── tasks/
    └── task-<ts>/                 # 一次 harness 运行 = 一个 task 目录
        ├── task.json              # task 元数据 + 跨 sprint 共享的 session IDs
        ├── inquiry/
        │   ├── session.jsonl      # Phase -1 原始对话流(不可改)
        │   └── spec.md            # Phase 0 产出的产品事实源
        └── progress/
            ├── sprint-1.json      # 第 1 轮 Sprint 计划 + 状态
            ├── sprint-2.json      # 第 2 轮(如果 review 不过)
            └── ...
```

Task 目录**永久保留**,不归档、不清理。

## 自定义质量标准

默认使用工具自带的 `control/golden-principles.md`。项目级覆盖:

```bash
mkdir -p .harness
cat > .harness/golden-principles.md << 'EOF'
# Golden Principles

1. 所有代码必须有中文注释
2. API 接口必须有错误码文档
EOF
```

harness 会优先读取项目级文件。

## 配置

运行交互式向导:

```bash
harness onboard
```

也可以手动创建 `.harness/config.json`(项目级)或 `~/.harness/config.json`(全局):

```json
{
  "model": "claude-sonnet-4-6",
  "apiBaseUrl": "http://localhost:4000/anthropic",
  "apiKey": "sk-xxx",
  "concurrency": 4,
  "maxSprints": 10,
  "maxNegotiateRounds": 30,
  "maxL1Retries": 5,
  "mcpServers": {
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"], "enabled": true }
  }
}
```

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `model` | 模型名称 | `claude-sonnet-4-6` |
| `apiBaseUrl` | API 端点(留空用 Anthropic 官方) | `""` |
| `apiKey` | API Key(留空用环境变量) | `""` |
| `concurrency` | review 阶段并行 reviewer 数 | `4` |
| `maxSprints` | 最大 sprint 轮数 | `10` |
| `maxNegotiateRounds` | 单轮 sprint 最大协商轮数 | `30` |
| `maxL1Retries` | L1 检查失败最大重试次数 | `5` |
| `mcpServers` | 额外挂载的 stdio MCP server(默认启用 Playwright) | 见 `config.default.json` |

### 使用自定义模型(通过 LiteLLM)

```bash
# 1. 启动 LiteLLM 代理
pip install litellm[proxy]
litellm --config config.yaml --port 4000

# 2. 配置 harness 指向代理
harness onboard
# → API Base URL: http://localhost:4000/anthropic

# 3. 正常使用
harness "你的任务"
```

## 架构

```
harness "task"
    │
    ▼
  ══ INQUIRY ══                          一次,跨所有 sprint 复用
    User ↔ Interrogator(苏格拉底式反问)
    → tasks/<id>/inquiry/session.jsonl

  Sprint 1..N:
    ══ NEGOTIATE ══
      Generator 起草 spec.md + sprint-N.json
      Evaluator 独立审查,双方对话直至 approved
      → tasks/<id>/inquiry/spec.md + progress/sprint-N.json

    ══ IMPLEMENT ══
      Generator 逐 feature 实现(跨 sprint 共享 session)
      L1 确定性检查(零 token):tests / lint / scripts
      失败 → 错误喂回 Generator → 重试

    ══ REVIEW (N+M 并行)══
      N 个 feature reviewer + M 个 dimension reviewer 独立评分
      approved = 所有 reviewer status === 'pass'

    → 不通过:进入下一轮 Sprint,previousReview 注入 negotiate

  ══ HOLISTIC ══                          最终全局审计
    Evaluator 以第三方用户视角冒烟测试整体交付
    → pass = 完成;fail = 进入下一轮 Sprint

  ✓ ALL APPROVED + HOLISTIC PASS
```

### 反馈层级

| 层级 | 时间尺度 | 机制 | 处理的问题 |
|-----|---------|------|-----------|
| **L0** | 启动时 | Inquiry 对话 | 意图澄清、XY 问题识别 |
| **L1** | 秒级 | 确定性检查(编译/测试/Lint) | 语法、类型、基础功能 |
| **L2** | 分钟级 | N+M 并行审查 | 设计合理性、代码质量 |
| **L3** | Sprint 级 | Holistic Review | 架构一致性、用户视角 |
| **L4** | 多 Sprint | previousReview 传递 | 累积反馈、持续改进 |

### 工具权限

| Agent | 允许的工具 | 职责 |
|-------|-----------|------|
| Interrogator | Read, Glob, Grep | 只反问、绝不总结、绝不 propose |
| Generator | Read, Write, Edit, Glob, Grep, Bash, TodoWrite, TodoRead, MCP | 起草 spec、写代码、改文件 |
| Evaluator | Read, Glob, Grep, Bash, TodoRead, MCP | 审查计划、跑测试、验证质量(**不能写文件**) |

权限通过 SDK `allowedTools` / `disallowedTools` 强制,不靠 prompt 约束。

## Prompt 模板

所有 prompt 在 `prompts/` 下,可以直接编辑调优:

```
prompts/
├── inquire/
│   └── interrogator.md
├── negotiate/
│   ├── generator-system.md
│   └── evaluator-system.md
├── implement/
│   ├── generator-system.md
│   ├── generator-feature.md
│   └── generator-retry.md
└── review/
    ├── reviewer.md
    └── holistic.md
```

## 断点恢复

进程随时可以中断。重新运行 `harness`(无参数)或 `harness execute <task-id>` 会:

1. 读 `task.json` 拿到跨 sprint 共享的 session IDs
2. 读最新的 `sprint-N.json` 判断 phase(negotiate / implement / review / done)
3. 跳过已完成的阶段和已 passing 的 feature
4. 从断点 resume SDK session(Generator / Evaluator 掌握完整历史)

Task 状态完全由文件结构隐含,没有中心状态机。
