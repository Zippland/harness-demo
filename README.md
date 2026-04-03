# Harness

Generator ↔ Evaluator 对抗架构的 AI 任务执行系统。

两个 Agent 协商计划、实现功能、独立审查，通过多轮 Sprint 迭代直到双方对结果满意。

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
- Claude Code CLI 已安装并登录（`claude` 命令可用）

## 使用

在任意目录下执行：

```bash
# 启动新任务
harness "构建一个 URL 解析库"

# 中途 Ctrl+C 后恢复（不需要重新输入任务）
harness
```

工作文件存储在当前目录的 `.harness/` 下：

```
.harness/
├── progress/
│   ├── sprint-1.json   # 第一轮计划 + 状态
│   ├── sprint-2.json   # review 后的修订计划
│   └── ...
└── golden-principles.md  # 可选：项目级别的质量标准覆盖
```

## 自定义质量标准

默认使用工具自带的 `control/golden-principles.md`。

如果某个项目需要不同的标准，在项目目录下创建：

```bash
mkdir -p .harness
cat > .harness/golden-principles.md << 'EOF'
# Golden Principles

1. 所有代码必须有中文注释
2. API 接口必须有错误码文档
3. ...
EOF
```

harness 会优先读取项目级别的文件。

## 架构

```
harness "task"
    │
    ▼
  Sprint N:
    ══ NEGOTIATE ══
      Generator 提计划 ↔ Evaluator 审计划
      双方对话协商，达成 Sprint Contract

    ══ IMPLEMENT ══
      Generator 逐 feature 实现
      L1 确定性检查（零 token）：tests / lint / scripts
      失败 → 错误喂回 Generator → 重试

    ══ REVIEW ══
      Evaluator 全局审查（主动验证，多维评分）
      有分歧 → 进入下一轮 Sprint 讨论

  ✓ ALL APPROVED
```

两个 Agent 的工具权限不同：

| Agent | 权限 | 职责 |
|-------|------|------|
| Generator | Read, Write, Edit, Glob, Grep, Bash | 提计划、写代码、改文件 |
| Evaluator | Read, Glob, Grep, Bash | 审计划、跑测试、验证质量（不能写文件） |

## Prompt 模板

所有 prompt 在 `prompts/` 目录下，可以直接编辑调优：

```
prompts/
├── generator-plan.md         # Generator 提出计划
├── generator-plan-revise.md  # Generator 回应 Evaluator 反馈
├── generator.md              # Generator 实现 feature
├── generator-retry.md        # Generator 修复 L1 失败
├── evaluator-plan.md         # Evaluator 审计划
└── evaluator-review.md       # Evaluator 全局审查
```

## 断点恢复

进程随时可以中断。重新运行 `harness` 会：

1. 读取最新的 `sprint-N.json`
2. 检查 `phase` 字段（negotiate / implement / review）
3. 跳过已完成的阶段和已 passing 的 feature
4. 从断点继续
