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
│  Phase 0: NEGOTIATE                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Generator ◄───────────────────────────► Evaluator      ││
│  │     │                                         │         ││
│  │     │ 1. Research task                        │         ││
│  │     │ 2. Draft contract                       │         ││
│  │     │ 3. ────────► propose ──────────►        │         ││
│  │     │              features                   │         ││
│  │     │                                         │         ││
│  │     │         ◄────── review ◄────────        │         ││
│  │     │                                         │         ││
│  │     │ 4. Revise or defend                     │         ││
│  │     │ 5. Iterate until approved               │         ││
│  └─────────────────────────────────────────────────────────┘│
│                           │                                  │
│                           ▼                                  │
│                    sprint-N.json                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: IMPLEMENT (L1 Loop)                               │
│                                                              │
│  for each feature:                                           │
│    1. Generator researches & implements                     │
│    2. Run deterministic checks (L1)                         │
│    3. If fail: Generator retries (up to maxL1Retries)       │
│    4. Update feature.status                                 │
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

### 4.2 两阶段 Agent 执行模式

每个 Agent 调用都分为两个阶段：

```
┌─────────────────────────────────────────────────────────────┐
│  RESEARCH MODE                                               │
│  ─────────────────────────────────────────────────────────── │
│  · Only read/search/explore — CANNOT create or modify files │
│  · Tools: Glob, Grep, Read, WebFetch, WebSearch, Bash(只读)  │
│  · 目的：深度理解任务上下文，避免浅层研究                     │
│                                                              │
│  Output: Research findings (injected into execute mode)     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  EXECUTE MODE                                                │
│  ─────────────────────────────────────────────────────────── │
│  · Full tool access based on role                           │
│  · Generator: Read + Write + Edit + Bash                    │
│  · Evaluator: Read only (Write/Edit disallowed)             │
│  · 目的：基于研究结果执行实际操作                             │
└─────────────────────────────────────────────────────────────┘
```

**设计理由**：

- 强制 Agent 在行动前先"看懂"任务，避免"一上来就动手"的浅层执行
- Research 阶段的工具受限防止 Agent 跳过思考直接修改文件
- 两阶段之间的上下文传递保证了研究成果被利用

---

## 五、核心数据结构

### 5.1 Sprint Contract (`sprint-N.json`)

```typescript
interface Sprint {
  sprint: number                    // Sprint 序号
  task: string                      // 原始任务描述
  phase: 'negotiate' | 'implement' | 'review' | 'done'
  reviewDimensions: ReviewDimension[]  // M 个评审维度
  context?: string                  // 任务上下文
  previousReview?: string           // 上一轮的评审反馈
  features: Feature[]               // N 个功能点
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
| **L1** | 秒级 | 确定性检查（编译、测试、Lint） | 语法错误、类型不匹配、基础功能 |
| **L2** | 分钟级 | N+M 并行审查 | 设计合理性、代码质量、功能完整性 |
| **L3** | Sprint 级 | Holistic Review | 架构一致性、跨功能问题 |
| **L4** | 多 Sprint | previousReview 传递 | 累积反馈、持续改进 |

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

### 7.1 协商流程

```
Generator                              Evaluator
    │                                      │
    │  1. Research task deeply             │
    │  2. Draft contract                   │
    │─────────────────────────────────────►│
    │     propose features                 │
    │                                      │  3. Research Generator's work
    │                                      │  4. Check research depth
    │◄─────────────────────────────────────│
    │     review: pass/needs-revision      │
    │                                      │
    │  5. If needs-revision:               │
    │     - Read feedback                  │
    │     - Revise OR defend position      │
    │─────────────────────────────────────►│
    │     revised contract / arguments     │
    │                                      │  6. Re-evaluate
    │                                      │     - Accept revisions OR
    │◄─────────────────────────────────────│     - Accept Generator's defense
    │     review: pass/needs-revision      │
    │                                      │
    └──────────── iterate ─────────────────┘
```

### 7.2 Evaluator 的审查标准（核心）

Evaluator 最重要的判断标准是 **研究深度**：

> "Could someone who never opened a single file have written this?"

**浅层研究的信号（拒绝）**：
- 通用的功能名如 "Core Module", "Utility Functions"
- 不引用实际源代码内容的 prompt
- 空的或通用的 background 字段
- 只检查文件存在性而不检查内容正确性的 checks

**深度研究的信号（接受）**：
- 功能名引用了源代码中实际存在的组件
- Prompt 引用了 Generator 实际读取的文件、函数、结构
- Background 基于真实理解解释了组件关系

### 7.3 允许 Generator 反驳

Evaluator 必须考虑 Generator 的论点：

> "If the Generator disagreed with previous feedback, are their arguments valid? Be willing to change your mind if they make a good case."

这保证了对抗是双向的——不是 Evaluator 单向压制 Generator。

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
}
```

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
│   ├── negotiate/           # 协商阶段提示词
│   │   ├── generator-research.md
│   │   ├── generator-execute.md
│   │   ├── generator-revise-research.md
│   │   ├── generator-revise-execute.md
│   │   ├── evaluator-research.md
│   │   └── evaluator-execute.md
│   ├── implement/           # 实现阶段提示词
│   │   ├── generator-research.md
│   │   ├── generator-execute.md
│   │   ├── generator-retry-research.md
│   │   └── generator-retry-execute.md
│   └── review/              # 审查阶段提示词
│       ├── reviewer-research.md
│       ├── reviewer-execute.md
│       ├── holistic-research.md
│       └── holistic-execute.md
├── control/
│   ├── golden-principles.md # 项目开发原则
│   ├── contract-format.md   # Sprint 合约格式说明
│   └── research-principles.md
└── .harness/
    └── progress/
        ├── sprint-1.json
        ├── sprint-2.json
        └── ...
```

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

### 10.4 为什么实现两阶段（Research → Execute）模式？

单阶段执行的问题：
- Agent 倾向于跳过思考直接动手
- 浅层研究导致低质量输出
- 无法强制 Agent "先看再做"

两阶段模式的优势：
- Research 阶段工具受限（只读），强制深度理解
- Execute 阶段有 Research 上下文，决策更准确
- 可审计：可以检查 Agent 的研究质量

---

## 十一、使用方式

### 11.1 基本命令

```bash
# 首次配置
harness onboard

# 启动新任务
harness "实现一个用户认证系统，支持邮箱密码登录和 JWT"

# 断点恢复（从上次中断处继续）
harness

# 重置所有进度
npm run reset
```

### 11.2 典型运行流程

```
$ harness "Implement a CLI todo app with add, list, and complete commands"

  ─── Harness: Generator ↔ Evaluator ───

  ━━━━━━━━━━━━━━━━━━━━━━━━━
       Sprint 1
  ━━━━━━━━━━━━━━━━━━━━━━━━━

  ══ NEGOTIATE — Sprint 1 ══

  ── Generator ──
    [research mode]
    ...researching task...
    [execute mode]
    ...drafting contract...

  ── Evaluator ──
    [research mode]
    ...reviewing contract...
    [execute mode]

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
    [research mode] ...
    [execute mode] ...
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
| 参考信号 | Reference Signal | Task Description |
| 误差信号 | Error Signal | Review Comments |
| 开环控制 | Open-loop Control | 单次 LLM 调用无反馈 |
| 闭环控制 | Closed-loop Control | Harness 的 Sprint 循环 |
| 级联控制 | Cascade Control | L1 → L2 → L3 → L4 |
| 阻尼 | Damping | maxL1Retries / maxNegotiateRounds |

---

*本文档随项目演进持续更新。最后更新：2026-04-18*
