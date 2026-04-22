===================
该文档是本项目的 **事实源**，改产品规则请先改本文档再改代码。
===================


# Harness 业务规格文档

> 基于控制论的 AI 对抗式长时任务执行系统

---

## 一、项目定位

Harness 是一个将控制论（Control Theory）原理应用于 AI Agent 系统的实验性项目。核心假设是：

> **大语言模型是一个会漂移的概率系统，稳定性必须来自外部的闭环约束，而非对模型本身的期望。**

本项目的目标不是"让模型输出更好"，而是"让包裹模型的控制系统更健壮"。

---

## 二、核心问题

### 2.1 Context Engineering 的天花板

Context Engineering（上下文工程）优化的是输入端——让模型在每一次推理中获得更好的上下文。但它没有回答一个根本性问题：

> **输出偏了之后怎么办？**

- 即使每一次推理的上下文都是"最优"的，系统仍然会随时间累积低频偏差
- LLM 会自我强化坏模式——生成第一个 Token 的微小偏差，作为上下文参与下一个 Token 的生成，误差逐步累积
- 在长时间运行的 Agent 任务中，单纯的输入端优化在数学上是徒劳的

### 2.2 自评偏差问题

Agent 会对自己的输出过度自信。在可验证的任务中（代码能不能跑、测试过不过），这可以靠确定性工具缓解。但在主观性任务中：

> 如果传感器和执行器是同一个实体，反馈信号就会被自利偏差污染，闭环退化为开环。

---

## 三、控制论映射

Harness 将控制论的五要素映射到 AI Agent 系统中：

| 控制论概念 | Harness 实现 |
|-----------|-------------|
| **被控对象 (Plant)** | LLM Agent —— 一个会漂移的概率系统 |
| **传感器 (Sensor)** | Evaluator Agent + 确定性检查（Linter/测试） |
| **控制器 (Controller)** | Sprint Contract 中的验收标准 + Golden Principles |
| **执行器 (Actuator)** | Generator Agent 的文件读写能力 |
| **反馈回路 (Feedback Loop)** | Sprint 循环 + N+M 并行审查 + Holistic Review |
| **参考信号 (Reference Signal)** | Spec (压缩 markdown，内联注入) + Session (jsonl，按需查阅) 的双层结构 |

### 核心设计原则

1. **生成与评估分离**：Generator 负责实现，Evaluator 负责审查，形成对抗张力
2. **状态外部化**：Sprint 文件持久化所有状态，模型可以忘记一切，但控制系统的状态不会丢失
3. **机械化判断**：`approved` 是 `results.every(r => r.status === 'pass')` 的计算结果，不是 LLM 的判断
4. **权限隔离**：Generator 拥有写权限，Evaluator 只能读取和审查

---

## 四、系统架构

### 4.1 Sprint 大循环

```
用户任务
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase -1: INQUIRY (live, human-in-loop)                    │
│                                                              │
│  User ◄──── Interrogator (苏格拉底式反问)                   │
│    │                │                                        │
│    │                │  只反问，不 propose                   │
│    │                │  用户说 "done" 收敛                   │
│    │                │                                        │
│    └──► Complete transcript (未压缩) ──► pending/<id>.json  │
│                                                              │
│  跨越所有后续 phase 的 reference signal                     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 0: NEGOTIATE                                         │
│                                                              │
│  Generator 角色 + 双产出职责 + inquiryPaths + principles    │
│    → appendSystemPrompt（永驻 Generator session 层）        │
│  Evaluator 角色 + 评审标准 + inquiryPaths + principles      │
│    → appendSystemPrompt（永驻 Evaluator session 层）        │
│                                                              │
│  Round 1:                                                   │
│    Generator new session + msg(previousReview or "draft")   │
│      → 写 spec.md + sprint-N.json + 解释文本                │
│    Evaluator new session + msg(Generator's text)            │
│      → Read 文件 + 独立验证 + 自由文本反馈 + {approved}     │
│      → if approved: STOP                                    │
│  Round 2..maxRounds:                                        │
│    Generator resume + msg(Evaluator's text)                 │
│      → revise 文件 或 defend 立场                           │
│    Evaluator resume + msg(Generator's text)                 │
│      → re-evaluate (含反驳合理性) + {approved}              │
│                                                              │
│  双方都可以评价/否决对方；approved 是机械触发器             │
│  写回 sprint.negotiateGenerator/EvaluatorSessionId          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    spec.md + sprint-N.json
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: IMPLEMENT (L1 Loop)                               │
│                                                              │
│  Generator 角色 + GOLDEN_PRINCIPLES + Constraints           │
│    + inquiryPointer (spec.md / session.jsonl 路径)          │
│    → SDK appendSystemPrompt（永驻 system 层，不被 compact） │
│                                                              │
│  for each feature:                                           │
│    1. 首个 feature：新建 session（带 systemPrompt）         │
│       后续 feature：resume sharedSessionId                  │
│    2. user message: TASK + BACKGROUND（精简）                │
│    3. Research & implement（前序 feature 的工具调用历史     │
│       通过 session 自然可见，由 SDK auto-compact 管理）     │
│    4. Run deterministic checks (L1)                         │
│    5. If fail: Generator retries (resume + 轻量 retry msg)  │
│    6. 写回 sprint.implementSessionId + feature.status       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: REVIEW (N+M Parallel)                             │
│                                                              │
│  ┌──────────────────┐   ┌──────────────────┐                │
│  │ Feature Reviewers│   │Dimension Reviewers│                │
│  │  (N parallel)    │   │  (M parallel)     │                │
│  │                  │   │                   │                │
│  │ · feature/f1     │   │ · Code Quality    │                │
│  │ · feature/f2     │   │ · Architecture    │                │
│  │ · feature/f3     │   │ · User Experience │                │
│  └──────────────────┘   └───────────────────┘                │
│           │                      │                           │
│           └──────────┬───────────┘                           │
│                      │                                       │
│                      ▼                                       │
│               Collect Reviews                                │
│         approved = all(status === 'pass')                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │  All reviews passed?        │
              └─────────────────────────────┘
                      │            │
                     Yes          No
                      │            │
                      ▼            ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  Phase 3: HOLISTIC      │   │  Next Sprint            │
│                         │   │  previousReview =       │
│  Final architectural    │   │    collectedReview      │
│  audit across all       │   │                         │
│  features               │   │  → Loop back to         │
│                         │   │    Phase 0              │
│  pass → DONE            │   └─────────────────────────┘
│  fail → Next Sprint     │
└─────────────────────────┘
```

### 4.2 Session 共享机制

同一 Sprint 内的多个 Feature 需要上下文传递。本项目早期用"每 feature 一个新 session + Summarizer 把执行 session 浓缩成 summary 注入下一 feature"的方案手工管理上下文滚动；2026-04 改为共享 session + SDK auto-compact。

```
implement 阶段开始
  ↓
  Generator 角色/principles/constraints/工作风格
    + inquiryPointer (spec.md & session.jsonl 路径，pointer 形态)
    → SDK appendSystemPrompt（永驻 system 层）
  ↓
feature 1: 新 session（带 systemPrompt）
  ↓ user message: TASK + BACKGROUND（不再内联 inquiry，模型按需 Read spec）
  ↓ 执行（写回 sprint.implementSessionId）

feature 2: resume sharedSessionId
  ↓ user message: TASK + BACKGROUND
  ↓ 执行（前序 feature 的工具调用历史在 session 里自然可见）

feature 3: resume sharedSessionId
  ↓ ...
```

**核心设计**：

| 层 | 内容 | 性质 |
|---|------|-----|
| **System** | Generator 角色 + GOLDEN_PRINCIPLES + Constraints + Working style + inquiryPointer (spec/session.jsonl 路径) | 永驻、不被 compact 触及 |
| **User message（feature 形态）** | featurePrompt + background | 每个 feature 一条，首个 = 后续对称 |
| **User message（retry 形态）** | check 输出 + 一句修复指令 | L1 失败时追加 |
| **Session 历史** | 前序 feature 的工具调用、文件读写、模型推理 | 由 SDK auto-compact 在阈值时自动压缩 |

**设计理由**：

- **首个 = 后续对称**：feature 之间无非对称的"开局/续接"区分，心智模型清晰
- **System 层永驻**：principles 不会被 compact 漂移；同时与每条 user message 解耦
- **状态外部化**：sprint.implementSessionId 持久化到 sprint 文件，断点恢复时可 resume
- **上下文质量**：后续 feature 看到的是前序 feature 的真实执行细节（工具调用、文件读写），而非 Summarizer 的有损压缩

**与早期 Summarizer 方案的差异**：

| 维度 | 早期（Summarizer） | 当前（共享 Session） |
|-----|-------------------|---------------------|
| 每 feature 的 LLM 调用数 | 2（执行 + Summarizer） | 1（执行） |
| 上下文质量 | 有损压缩（≤300 字 summary） | 原始执行历史 + SDK auto-compact |
| 上下文增长 | 受 summary 累加控制 | 由 SDK 自动管理 |
| 状态外部化粒度 | 每 feature 一段人可读 summary | sessionId + feature.status |
| Prompt 模板复杂度 | 4 个文件（generator/retry/summary/+变量拼接） | 3 个文件（system/feature/retry，模板纯净） |

**断点恢复**：implement 中途中断后重跑，若 sprint.implementSessionId 存在且 SDK 的 session jsonl 仍在原地（`~/.claude/projects/<hash>/<sid>.jsonl`），自动 resume；若 session jsonl 已被清理，需手动清掉 sprint 文件中的 implementSessionId 后再跑（视为重新开局）。

---

## 五、核心数据结构

### 5.1 Sprint Contract (`sprint-N.json`)

```typescript
interface Sprint {
  sprint: number                    // Sprint 序号
  taskId: string                    // 所属 task ID（冗余存储，便于人工调试）
  task: string                      // 原始任务描述
  phase: 'negotiate' | 'implement' | 'review' | 'done'
  reviewDimensions: ReviewDimension[]  // M 个评审维度
  context?: string                  // 任务上下文
  previousReview?: string           // 上一轮的评审反馈
  features: Feature[]               // N 个功能点
  negotiateGeneratorSessionId?: string  // negotiate Generator session，断点恢复
  negotiateEvaluatorSessionId?: string  // negotiate Evaluator session，断点恢复
  implementSessionId?: string       // implement 阶段共享的 SDK session，断点恢复用
}

interface Feature {
  id: string                        // 唯一标识 (如 "f1", "auth-login")
  name: string                      // 功能名称
  prompt: string                    // 详细实现指令
  background: string                // 背景信息、依赖关系
  evaluation: {
    checks: string[]                // L1 确定性检查命令
    intent: string                  // 功能意图（供 Evaluator 理解）
  }
  status: 'pending' | 'failing' | 'passing'
}

interface ReviewDimension {
  name: string                      // 如 "Code Quality"
  description: string               // 评审标准描述
}
```

### 5.2 评审结果

```typescript
interface SingleReview {
  id: string                        // feature ID 或 dimension name
  type: 'feature' | 'dimension'
  status: 'pass' | 'needs-revision'
  score: number                     // 1-5 分
  comment: string                   // 具体反馈
}

interface ReviewResult {
  approved: boolean                 // 机械计算: all(status === 'pass')
  reviews: { featureId: string; status: string; comment: string }[]
  overallComment: string
}
```

---

## 六、反馈层级

Harness 实现了多层级联控制（Cascade Control）：

| 层级 | 时间尺度 | 机制 | 处理的问题 |
|-----|---------|------|-----------|
| **L0** | 启动时 | Inquiry 对话（Interrogator ↔ 人） | 意图澄清、XY 问题识别、隐含假设暴露 |
| **L1** | 秒级 | 确定性检查（编译、测试、Lint） | 语法错误、类型不匹配、基础功能 |
| **L2** | 分钟级 | N+M 并行审查 | 设计合理性、代码质量、功能完整性 |
| **L3** | Sprint 级 | Holistic Review | 架构一致性、跨功能问题 |
| **L4** | 多 Sprint | previousReview 传递 | 累积反馈、持续改进 |

L0 产出的 inquiry transcript 是所有后续层级的**参考信号**——当某层检测到偏离时，它定义了"偏离的是什么"。其他层是**误差信号**，L0 是**参考信号**。

### L1 检查示例

```json
{
  "checks": [
    "npm run build",
    "npm test -- --testPathPattern=auth",
    "grep -q 'export function login' src/index.ts"
  ],
  "intent": "用户可以通过邮箱密码登录，返回 JWT token"
}
```

### N+M 并行审查

- **N**: 每个 Feature 一个 Reviewer Agent
- **M**: 每个 Review Dimension 一个 Reviewer Agent
- 并发控制：`runPool(fns, config.concurrency)`
- 审查者彼此独立，不共享上下文，避免群体思维

---

## 七、对抗式协商机制

### 7.1 协商架构（双 session 互发 user message）

negotiate 阶段是一个对抗对话。两个独立持久 session：

| 角色 | Session | system prompt | 写权限 |
|---|---|---|---|
| **Generator** | `negotiateGeneratorSessionId` | 角色 + 双产出职责 + inquiry 路径 + principles + contractFormat | spec.md + sprint-N.json |
| **Evaluator** | `negotiateEvaluatorSessionId` | 角色 + 评审标准 + inquiry 路径 + principles + contractFormat | 只读 |

**对话协议**：每一方看到的"user message"都是对方上一轮的自由文本输出。两个 session 平行存在，互为对方的"对话方"。

```
Generator session                      Evaluator session
    │                                      │
    │  Round 1                             │
    │  appendSystemPrompt + msg(start)     │
    │  → 写 spec.md + sprint-N.json        │
    │  → 自由文本（解释做了什么）          │
    │     ────────────────────────────────►│
    │                                      │  appendSystemPrompt + msg(Gen text)
    │                                      │  → Read 文件 + 独立验证
    │                                      │  → 自由文本反馈 + {approved}
    │     ◄────────────────────────────────│
    │  Round 2 (if not approved)           │
    │  resume + msg(Eval text)             │
    │  → revise 文件 OR defend             │
    │  → 自由文本                          │
    │     ────────────────────────────────►│
    │                                      │  resume + msg(Gen text)
    │                                      │  → re-evaluate (含反驳合理性)
    │                                      │  → 自由文本 + {approved}
    │     ◄────────────────────────────────│
    │  ...直到 approved=true 或 maxRounds  │
```

**双产出**：

- **`spec.md`**（在 inquiry 目录下）—— 产品事实源，纯 markdown 叙述
- **`sprint-N.json`**（在 progress 目录下）—— 控制器状态，结构化 JSON

由 Generator 同时维护、Evaluator 同时审查。

### 7.2 Evaluator 的审查标准（核心）

Evaluator 最重要的判断标准是 **证据深度**——spec.md 与 sprint-N.json 是否暴露出对真实源码（或 inquiry 转录中明确提及的领域）的深度参与痕迹：

> "If I hand these two files to a fresh engineer, can they locate every claim inside the source / the inquiry transcript?"

审查的是**结果**（文件里的证据），不是**过程**（Generator 怎么想的）。

**弱证据信号（拒绝）**：
- 通用的功能名如 "Core Module"、"Utility Functions"
- prompt 字段不引用实际文件 / 函数 / 类型
- background 字段空白或只复述任务
- checks 只检查文件存在性，不验证内容
- spec.md 是任务的 paraphrase，没有 inquiry 中浮现的具体决策

**强证据信号（接受）**：
- 功能名引用源码中真实存在的组件
- prompt 引用具体文件 / 函数 / 数据结构 / 现有模式
- background 解释组件关系，含浅层阅读者写不出的细节
- checks 验证内容 / 行为
- spec.md 的"in scope"和"explicitly ruled out"都能在 inquiry 转录里找到对应锚点

**独立验证**：挑 2-3 条声明，去源码 / inquiry 转录中核对。蒸发的声明即拒绝信号。

### 7.3 终止条件：approved 是机械触发器

Evaluator 在每轮自由文本输出之外，通过 SDK 的 StructuredOutput tool 给出 `{ approved: boolean }`。orchestrator 机械读取该字段：true 即结束循环。Generator 不参与终止决策。

`approved` 是**机械逻辑**（不可被自然语言"说服"绕过），自由文本是**对话内容**（可被反驳、可让步）—— 两者职责清晰分离，是 SDK `StructuredOutput` tool + 自由文本天然并存机制的直接利用。

### 7.4 双方都可以评价 / 否决

- Generator 收到 Evaluator 反馈后，可以 revise 也可以 defend；defend 时把论据写在自由文本里
- Evaluator 收到 Generator 反驳后，可以接受让步（下一轮 approved=true 或调整反馈）也可以驳回反驳

system prompt 明确告诉双方："对方的言论可以评价和否决，不要为结束循环而妥协，也不要为坚持立场而拒绝合理论点"。这保证对抗是双向的，不是单向压制。

### 7.5 断点恢复

每完成一轮 round 后，sprint 文件写回最新的 `negotiateGeneratorSessionId` 和 `negotiateEvaluatorSessionId`。中断重跑时：
- 两个 sessionId 都存在 + SDK jsonl 仍在原地 → 双 session resume，从中断处继续
- 任一 sessionId 失效 → fail-fast，需手动清理 sprint 文件

### 7.6 sprint > 1 的 previousReview 注入

当 sprint > 1（前一 sprint 未通过 review，需要重新协商），上一 sprint 的 `collectedReview` 作为 Generator 第一轮的 user message 直接注入。不再走"特殊 revise 模板" —— previousReview 就是对话里的下一句话。

---

## 八、配置系统

### 8.1 配置优先级

```
项目级 (.harness/config.json)
    ↓
全局级 (~/.harness/config.json)
    ↓
默认值 (config.default.json)
```

### 8.2 配置项

```typescript
interface HarnessConfig {
  model: string              // 使用的模型 (如 "claude-sonnet-4-20250514")
  apiBaseUrl: string         // API 端点
  apiKey: string             // API 密钥
  concurrency: number        // 并行审查数量
  maxSprints: number         // 最大 Sprint 数
  maxNegotiateRounds: number // 最大协商轮数
  maxL1Retries: number       // L1 检查最大重试次数
  customModel?: {            // 自定义模型配置 (通过 LiteLLM 代理)
    backendUrl: string
    backendModel: string
    litellmPort: number
    backendApiKey: string
  }
  mcpServers?: Record<string, {  // 外接 MCP server（默认开 Playwright）
    command: string              // 启动命令，如 "npx"
    args?: string[]              // 启动参数，如 ["-y", "@playwright/mcp@latest"]
    env?: Record<string, string>
    enabled?: boolean            // 默认 true；写 false 即关
  }>
}
```

**MCP server 默认配置**：`config.default.json` 默认启用 Playwright MCP（`@playwright/mcp`），挂在 **Generator + Evaluator** 上作为渲染层 sensor —— 让两个 agent 都能真实打开页面验证 UI 任务。Interrogator 故意不挂（纯对话阶段）。MCP 工具走 SDK `mcp__<server>__<tool>` 命名，注册时用通配 `mcp__<server>__*` 写进 `allowedTools`。用户可在 `.harness/config.json` 里写 `{"mcpServers": {"playwright": {"enabled": false}}}` 关闭，或追加新的 stdio MCP server。

---

## 九、目录结构

```
harness-demo/
├── orchestrator.ts          # 主循环入口
├── bin/harness.mjs          # CLI shebang 入口
├── src/
│   ├── types.ts             # 类型定义
│   ├── config.ts            # 配置加载
│   ├── agent.ts             # Agent 调用封装
│   ├── sprint.ts            # Sprint 文件 CRUD
│   ├── phases.ts            # 四个阶段实现
│   ├── litellm.ts           # LiteLLM 代理管理
│   ├── onboard.ts           # 交互式配置向导
│   └── ui.ts                # 终端输出格式化
├── prompts/
│   ├── inquire/             # Inquiry 阶段提示词
│   │   └── interrogator.md
│   ├── negotiate/           # 协商阶段提示词
│   │   ├── generator-system.md
│   │   └── evaluator-system.md
│   ├── implement/           # 实现阶段提示词
│   │   ├── generator-system.md
│   │   ├── generator-feature.md
│   │   └── generator-retry.md
│   └── review/              # 审查阶段提示词
│       ├── reviewer.md
│       └── holistic.md
├── control/
│   ├── golden-principles.md # 项目开发与研究原则
│   └── contract-format.md   # spec.md + sprint-N.json 双产出格式说明
└── .harness/
    ├── config.json          # 项目级配置（可选）
    ├── golden-principles.md # 项目级原则覆盖（可选）
    └── tasks/               # 所有 task，每个完整隔离，永久保留
        └── task-<ts>/
            ├── task.json    # task 元数据：taskId, originalTask, createdAt 等
            ├── inquiry/
            │   ├── session.jsonl  # inquiry 阶段对话流（jsonl，每行一条 message）
            │   └── spec.md        # negotiate 阶段填入的产品事实源（markdown）
            └── progress/
                ├── sprint-1.json
                ├── sprint-2.json
                └── ...
```

**task 隔离**：每个 `harness "<task>"` 运行创建一个独立的 `task-<ts>/` 目录。多个 task 永远不会共享文件、永远不会冲突。`task.json` 是 task 元数据快照（人/工具调试用），状态由文件结构隐含判断（无 status 字段）：

| 状态 | 判断条件 |
|---|---|
| **pending** | `progress/` 不存在或无 sprint 文件 |
| **in-progress** | 有 sprint 文件但最新的 `phase !== 'done'` |
| **completed** | 最新 sprint 的 `phase === 'done'` |

`src/inquire.ts` 管理 Phase -1 对话循环 + task 生命周期工具函数（`taskStatus`, `listTasks`, `listPendingTasks`, `pickTaskToExecute`）。每个 task 对应一个 `tasks/task-<ts>/` 目录，包含 **inquiry/session.jsonl**（原始流）和 **inquiry/spec.md**（negotiate 后的产品事实源）。**没有 archive 动作** —— task 完成后文件原地保留。

---

## 十、关键设计决策

### 10.1 为什么是 Generator ↔ Evaluator 而不是单 Agent？

**单 Agent 自评的问题**：
- 自利偏差：Agent 对自己的输出过度自信
- 没有外部压力：缺乏推动质量收敛的张力
- 反馈信号被污染：传感器和执行器是同一个实体

**对抗架构的优势**：
- 评估压力迫使生成质量收敛（类似 GAN）
- 独立的 Evaluator 不受 Generator 上下文污染
- 双方都有机会表达和反驳

### 10.2 为什么 Sprint 文件需要外部化？

LLM 没有记忆。每个新会话开始时，Agent 对之前发生的事一无所知。

状态外部化的好处：
- 断点恢复：随时可以从中断处继续
- 可追溯：每个 Sprint 的决策都有记录
- 可调试：人可以直接阅读和修改 Sprint 文件
- 跨会话协作：不同 Agent 会话可以读取同一份状态

### 10.3 为什么 `approved` 是机械计算而不是 LLM 判断？

```typescript
const approved = reviews.length > 0 && reviews.every((r) => r.status === 'pass')
```

- 确定性：相同的输入永远产出相同的结果
- 不可被 Agent "说服"绕过
- 清晰的退出条件

### 10.4 为什么剥离 Research → Execute 两阶段模式？

历史上本项目曾为每次 Agent 调用拆出独立的 research 和 execute 两阶段，研究阶段工具受限（只读），完成后再切入执行阶段。设计理由有三：

- 强制 Agent 在行动前先"看懂"任务，避免浅层执行
- Execute 阶段复用 Research 的上下文积累
- 研究质量可审计（审查研究过程本身）

随着模型 agentic 能力的提升，这三条都显出了补偿性本质——它们约束的是**模型内部的思考过程**，而非可外部验证的**结果、角色或状态**。强模型天然会先探索再动手，两段 session 切换反而切断了"边研究边实验边调整"的自然流。可审计也可以从"审过程"改为"审结果证据"——contract 里有无具体文件/函数/代码引用。

本项目在 2026-04 剥离两阶段，保留所有控制论结构性约束（权限隔离、机械化 approved、N+M 审查、状态外部化、三层阻尼），并把 Evaluator 的"研究深度"维度改写为"证据深度"（见 7.2）。这是 12.3 "剥离不再需要的约束" 承诺的首次兑现。

### 10.5 为什么 spec 由对抗 negotiate 生成、而不是 Interrogator 单边写？

Inquiry 阶段（Phase -1）只产出**一份**原始信号：`session.jsonl`（完整对话流）。spec.md 是**空占位文件**，由 Phase 0 negotiate 阶段的 Generator ↔ Evaluator 对抗对话产生。

**演进背景**：早期设计让 Interrogator 在用户说 "done" 后单独调一次自己（带 SPEC_SCHEMA 的 structured output），由 Interrogator 写 markdown spec。这是"压缩"动作，且是单边的——一个 agent 自己说自己理解了什么，没有外部审查。

**单边压缩的两个根本问题**：

- 自利偏差（SPEC §2.2）：Interrogator 对自己的总结过度自信，没有外部张力推动质量收敛
- 信息丢失：压缩即漂移之母——negative space（被拒绝的方向）尤其容易在压缩中蒸发

**新设计：spec 由对抗 negotiate 生成**：

- Inquiry：Interrogator 只反问、永不总结；唯一产出 `session.jsonl`
- Negotiate：Generator 起草 spec.md（同时起草 sprint-N.json）；Evaluator 独立读 session.jsonl + 验证 spec 是否忠实于 inquiry；Generator 可以反驳，Evaluator 可以让步——直到双方在 `approved=true` 上达成一致
- 这与 GAN 同构：spec 在生成器和判别器之间收敛，而非由生成器一锤子定音

**双层 reference signal 仍然成立**——但角色变了：

| 文件 | 角色 | 何时写 |
|---|---|---|
| `session.jsonl` | **Ground truth**（不可压缩、永久原始流） | Inquiry 阶段，按对话顺序追加 |
| `spec.md` | **协商共识的产品事实源**（人可读叙述） | Negotiate 阶段，对抗式产生；implement / review 阶段只读 |
| `sprint-N.json` | **控制器状态**（结构化 features / dimensions / status） | Negotiate 阶段产生；implement 阶段更新 status |

**关键约束（更新版）**：spec.md 在 negotiate 阶段被 Generator 反复修改，但一旦 negotiate 结束（approved=true），它对下游（implement / review）就是只读的。任何后续修正必须通过新 sprint 的 negotiate（previousReview 触发）或新 inquiry。session.jsonl 任何时候都是只读、不可覆盖。旧 inquiry 目录永久保留——思想化石层。

### 10.6 为什么 Inquiry 和 Execute 分两阶段？

Inquiry 需要 live 人机对话；Execute 要求 fire-and-forget 自主执行。两者的运行模式根本不同。

分开的好处：
- **保留工具性**：`harness execute` 依然可以放 CI、夜间运行、长任务托管
- **discover 完可中断**：用户 discover 后可以去睡觉，`execute` 任何时候再跑
- **多任务队列**：discover 多个 task 产生多个 pending，按需 execute
- **默认强 discovery**：`harness "task"` 默认走 discover + execute；opt-out 需要显式 `execute --direct`

---

## 十一、使用方式

### 11.1 基本命令

```bash
# 首次配置
harness onboard

# 启动新任务（默认 discover + execute，语法糖）
harness "实现一个用户认证系统，支持邮箱密码登录和 JWT"

# 只做 discovery（产出 pending，不立即 execute）
harness discover "实现用户认证"

# 只 execute（读最新 pending 或指定 task-id）
harness execute
harness execute task-1730000000

# 熟练用户：跳过 discovery（opt-out）
harness execute --direct "实现一个明确无歧义的小功能"

# 断点恢复或列 pending
harness

# 重置所有进度
npm run reset
```

### 11.2 典型运行流程

```
$ harness "Implement a CLI todo app with add, list, and complete commands"

  ══ INQUIRY ══

  Discuss with the Interrogator to clarify what this task really means.
  Type "done" when you are ready to begin execution.

  ── Interrogator ──
    > Who will use this CLI — yourself, a team, or public distribution?
  You: just me, local use

  ── Interrogator ──
    > Should completed todos persist across invocations, or is in-memory fine?
  You: persist, JSON file

  ── Interrogator ──
    > What counts as failure here — corrupt JSON, ambiguous commands, or something else?
  You: done

  ✓ Inquiry saved: .harness/inquiry/task-1730000000.md

  ─── Harness: Generator ↔ Evaluator ───

  ━━━━━━━━━━━━━━━━━━━━━━━━━
       Sprint 1
  ━━━━━━━━━━━━━━━━━━━━━━━━━

  ══ NEGOTIATE — Sprint 1 ══

  ── Generator ──
    ...drafting contract...

  ── Evaluator ──
    ...reviewing contract...

  ┌─────────────────────────────────────────────┐
  │ Review: 3 features                          │
  ├─────────────────────────────────────────────┤
  │ ✓ todo-add     │ pass    │ Well-scoped     │
  │ ✓ todo-list    │ pass    │ Clear criteria  │
  │ ✓ todo-complete│ pass    │ Good edge cases │
  └─────────────────────────────────────────────┘

  Sprint Contract agreed (round 1)

  Sprint 1: 3 features
    · todo-add
    · todo-list
    · todo-complete

  ══ IMPLEMENT — Sprint 1 ══  3 features

  [1/3] todo-add
    ...implementing...
    $ npm test -- todo-add
    ✓ 2 checks passed
    L1 PASS

  [2/3] todo-list
    ...
    L1 PASS

  [3/3] todo-complete
    ...
    L1 PASS

  ████████████████████████████████  L1: 3/3

  ══ REVIEW — Sprint 1 ══

    ⟳ reviewer: feature/todo-add
    ⟳ reviewer: feature/todo-list
    ⟳ reviewer: feature/todo-complete
    ⟳ reviewer: dimension/Code Quality
    ⟳ reviewer: dimension/User Experience

    ✓ feature/todo-add [5/5] Correct implementation...
    ✓ feature/todo-list [5/5] Handles empty list...
    ✓ feature/todo-complete [4/5] Works but could improve UX...
    ✓ dimension/Code Quality [5/5] Clean, typed code...
    ✓ dimension/User Experience [4/5] Good CLI feedback...

  ══ HOLISTIC REVIEW ══

    ✓ Holistic verdict: All features work together coherently...

  ✓ ALL APPROVED + HOLISTIC PASS — 3 features across 1 sprint(s)
```

---

## 十二、未来发展方向

### 12.1 短期改进

1. **更丰富的 L1 检查类型**
   - 视觉回归测试（截图比对）
   - API 端点验证
   - 性能基准测试

2. **协商记忆**
   - 跨 Sprint 的 Evaluator 记忆
   - 学习项目特定的审查偏好

3. **并行 Feature 实现**
   - 当前是串行实现每个 Feature
   - 可以分析依赖图，并行实现无依赖的 Feature

### 12.2 中期探索

1. **"垃圾回收" Agent**
   - 参考 OpenAI 的设计
   - 定期扫描代码库，检测架构退化
   - 自动开出重构 PR

2. **多模型对抗**
   - Generator 和 Evaluator 使用不同模型
   - 利用模型差异产生更强的对抗张力

3. **人类反馈集成**
   - 允许人类在 Review 阶段介入
   - 人类反馈被编码进 Golden Principles

### 12.3 长期愿景

1. **Harness 自进化**
   - 当 Agent 在某类问题上反复犯错时
   - 自动生成新的 Linter 规则或审查维度
   - 控制系统本身持续改进

2. **模型能力跟踪**
   - 每个 Harness 组件编码了一个关于模型局限性的假设
   - 随着模型进化，自动检验和调整这些假设
   - 剥离不再需要的约束，为新能力腾出空间
   - ✓ 2026-04：剥离 research-execute 两阶段模式（首个自我剥离案例，见 10.4）
   - ✓ 2026-04：新增 Inquiry Phase 和 L0 反馈层（建立 reference signal，见 10.5/10.6）
   - ✓ 2026-04：剥离 implement 阶段的 Summarizer 机制，改为共享 session + SDK auto-compact + appendSystemPrompt（见 4.2）。第二个自我剥离案例，约束机制：手工 summary 在 SDK 提供 auto-compact 后即变冗余
   - ✓ 2026-04：剥离 negotiate 阶段的"首轮 vs 续轮非对称 prompt"和"Interrogator 单边写 spec"，改为双 session 互发 user message + spec.md 由 negotiate 对抗生成（见 §7、§10.5）。第三个自我剥离案例，约束机制：单边压缩漂移之母 → 让对抗生成 spec，与 GAN 同构

---

## 十三、结对开发指南

### 13.1 代码规范

- 所有新功能必须通过现有的 Golden Principles 审查
- 提示词修改需要同时更新相应的测试用例
- Sprint 文件格式变更需要向后兼容

### 13.2 修改 Harness 本身

修改 Harness 组件时，问自己：

1. **这个修改是在增加确定性还是概率性？** 优先选择确定性。
2. **这个反馈信号是否足够精确？** 模糊的信号会导致模糊的修正。
3. **这个约束是否可以被 Agent "说服"绕过？** 如果可以，它就不是真正的约束。

### 13.3 添加新阶段

如果需要添加新的处理阶段：

1. 在 `src/types.ts` 中扩展 `Sprint.phase` 类型
2. 在 `src/phases.ts` 中实现新阶段函数
3. 在 `orchestrator.ts` 中更新主循环
4. 在 `prompts/` 下创建对应的提示词文件
5. 确保阶段状态可以正确持久化和恢复

### 13.4 调试技巧

```bash
# 查看当前 Sprint 状态
cat .harness/progress/sprint-*.json | jq

# 手动修改 Sprint 文件后重新运行
# （系统会从当前 phase 继续）
harness

# 强制重新协商（删除 Sprint 文件）
rm .harness/progress/sprint-N.json && harness "original task"
```

---

## 十四、参考文献

1. Wiener, N. (1948). *Cybernetics: Or Control and Communication in the Animal and the Machine*. MIT Press.
2. OpenAI. (2026). *Harness Engineering: Leveraging Codex in an Agent-First World*.
3. Anthropic. (2026). *Harness Design for Long-Running Application Development*.
4. LangChain. (2026). *Improving Deep Agents with Harness Engineering*.
5. Hashimoto, M. (2026). *My AI Adoption Journey*.

---

## 附录 A：控制论术语对照表

| 中文 | 英文 | Harness 中的实现 |
|-----|------|-----------------|
| 被控对象 | Plant | LLM Agent |
| 传感器 | Sensor | Evaluator + L1 Checks |
| 控制器 | Controller | Sprint Contract |
| 执行器 | Actuator | Generator's Write/Edit |
| 反馈回路 | Feedback Loop | Sprint Cycle |
| 负反馈 | Negative Feedback | needs-revision → retry |
| 参考信号 | Reference Signal | Inquiry Spec（压缩 markdown）+ Session.jsonl（未压缩原始流）|
| 误差信号 | Error Signal | Review Comments |
| 开环控制 | Open-loop Control | 单次 LLM 调用无反馈 |
| 闭环控制 | Closed-loop Control | Harness 的 Sprint 循环 |
| 级联控制 | Cascade Control | L0 → L1 → L2 → L3 → L4 |
| 阻尼 | Damping | maxL1Retries / maxNegotiateRounds |

---

*本文档随项目演进持续更新。最后更新：2026-04-19*
