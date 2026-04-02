/**
 * Harness Orchestrator — 两阶段闭环控制 + 实时活动流
 *
 * 用法:
 *   npm start "帮我做一个 markdown 链接检查 CLI 工具"
 *   npm start                # 续跑上次未完成的 plan
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

// ─── Paths ───

const ROOT = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(ROOT, 'project')
const PROGRESS_FILE = resolve(ROOT, 'progress.json')
const PRINCIPLES_FILE = resolve(ROOT, 'control/golden-principles.md')

// ─── Config ───

const MAX_RETRIES = 5
const MAX_TURNS = 30
const TEST_TIMEOUT_MS = 60_000

// ─── Types ───

interface Feature {
  id: string
  name: string
  prompt: string
  status: 'pending' | 'failing' | 'passing'
}

interface Progress {
  task: string
  features: Feature[]
}

// ─── ANSI helpers ───

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

function shortPath(p: string): string {
  if (!p) return ''
  return relative(ROOT, p.startsWith('/') ? p : resolve(ROOT, p)) || p
}

// ─────────────────────────────────────────────────
// Live Activity Logger
//
// 拦截 SDK 的每条消息，把 agent 的工具调用
// 实时打印出来，让人看到 agent 在做什么。
// ─────────────────────────────────────────────────

function logMessage(msg: any): void {
  // assistant 消息包含 text 和 tool_use 内容块
  if (msg.type === 'assistant') {
    const content = msg.message?.content
    if (!Array.isArray(content)) return

    for (const block of content) {
      if (block.type === 'text' && block.text?.trim()) {
        // agent 的思考/说明文字，取前 120 字符
        const text = block.text.trim().replace(/\n/g, ' ').slice(0, 120)
        console.log(`    ${dim(text)}`)
      }
      if (block.type === 'tool_use') {
        logToolCall(block.name, block.input)
      }
    }
  }
}

function logToolCall(name: string, input: any): void {
  switch (name) {
    case 'Read':
      console.log(`    ${cyan('Read')}  ${shortPath(input?.file_path)}`)
      break
    case 'Write':
      console.log(`    ${yellow('Write')} ${shortPath(input?.file_path)}`)
      break
    case 'Edit':
      console.log(`    ${yellow('Edit')}  ${shortPath(input?.file_path)}`)
      break
    case 'Bash':
      console.log(`    ${dim('$')} ${dim((input?.command ?? '').slice(0, 100))}`)
      break
    case 'Glob':
      console.log(`    ${cyan('Glob')}  ${input?.pattern}`)
      break
    case 'Grep':
      console.log(`    ${cyan('Grep')}  "${input?.pattern}"`)
      break
    default:
      console.log(`    ${cyan(name)}`)
  }
}

// ─────────────────────────────────────────────────
// Sensor
// ─────────────────────────────────────────────────

function runTests(pattern: string): { pass: boolean; output: string } {
  console.log(`    ${cyan('Test')}  vitest --testNamePattern "${pattern}"`)
  try {
    const out = execSync(
      `npx vitest run --testNamePattern "${pattern}" --reporter verbose 2>&1`,
      { cwd: PROJECT_DIR, encoding: 'utf-8', timeout: TEST_TIMEOUT_MS },
    )
    return { pass: true, output: tail(out) }
  } catch (e: any) {
    return { pass: false, output: tail((e.stdout ?? '') + (e.stderr ?? '')) }
  }
}

function tail(s: string, max = 3000): string {
  return s.length > max ? '...(truncated)\n' + s.slice(-max) : s
}

/** 从 vitest 输出中提取通过/失败数 */
function parseTestSummary(output: string): string {
  const match = output.match(/Tests\s+(.+)/)
  return match ? match[1].trim() : ''
}

// ─────────────────────────────────────────────────
// Actuator
// ─────────────────────────────────────────────────

async function sendToAgent(
  prompt: string,
  opts: { cwd: string; resume?: string; label?: string } = { cwd: ROOT },
): Promise<string> {
  let sessionId = ''

  if (opts.label) {
    console.log(`\n  ${dim(`── ${opts.label} ──`)}`)
  }

  const q = query({
    prompt,
    options: {
      cwd: opts.cwd,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      permissionMode: 'acceptEdits',
      maxTurns: MAX_TURNS,
      ...(opts.resume ? { resume: opts.resume } : {}),
    },
  })

  for await (const msg of q) {
    logMessage(msg)

    if ('session_id' in msg && msg.session_id) {
      sessionId = msg.session_id as string
    }
  }

  return sessionId
}

// ─────────────────────────────────────────────────
// Phase 0 — Plan
// ─────────────────────────────────────────────────

async function plan(task: string): Promise<void> {
  console.log(bold(`\n  PLAN: "${task}"\n`))

  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')

  await sendToAgent(
    `
You are the Planner in a test-driven harness. Your job is to scaffold a project
so that a separate Executor agent can implement it feature by feature.

# Task
${task}

# What you must produce

## 1. project/tests/index.test.ts
Write comprehensive vitest tests — these are the acceptance criteria.
- 5–10 describe() blocks, one per feature
- At least 4 it() cases per feature, including edge cases
- Tests must be deterministic: no network, no real filesystem

## 2. project/src/index.ts
Export every function tested above as a stub:
  export function foo(...): ReturnType { throw new Error('Not implemented') }

## 3. progress.json  (write to: ${PROGRESS_FILE})
\`\`\`json
{
  "task": "<original task>",
  "features": [
    {
      "id": "<must exactly match the describe() block name>",
      "name": "<short display name>",
      "prompt": "<one paragraph: what to implement and key constraints>",
      "status": "pending"
    }
  ]
}
\`\`\`

# Golden Principles
${principles}

# Rules
- feature.id MUST exactly match the describe() block name in the tests
- Write tests FIRST, stubs SECOND, progress.json THIRD
- Do not implement any logic — only stubs
- Keep the project self-contained (no external API calls, no network)
`.trim(),
    { cwd: ROOT, label: 'Planner Agent' },
  )

  // 验证 plan 输出
  if (!existsSync(PROGRESS_FILE)) {
    console.error(red('\n  Plan failed: progress.json not created'))
    process.exit(1)
  }

  const progress: Progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  console.log(green(`\n  Plan complete: ${progress.features.length} features\n`))

  for (const f of progress.features) {
    console.log(`    ${dim('·')} ${f.name}`)
  }
}

// ─────────────────────────────────────────────────
// Phase 1 — Execute
// ─────────────────────────────────────────────────

async function execute(): Promise<void> {
  const progress: Progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')

  const total = progress.features.length
  const done = progress.features.filter((f) => f.status === 'passing').length

  console.log(bold(`\n  EXECUTE: ${total - done} remaining / ${total} total\n`))

  for (let i = 0; i < progress.features.length; i++) {
    const feature = progress.features[i]

    if (feature.status === 'passing') {
      console.log(`  ${dim(`[${i + 1}/${total}]`)} ${dim(feature.name)} ${green('done')}`)
      continue
    }

    console.log(`\n  ${bold(`[${i + 1}/${total}]`)} ${bold(feature.name)}`)

    // Step 1: agent 实现
    const sessionId = await sendToAgent(
      `
# Golden Principles
${principles}

# Task
${feature.prompt}

# Constraints
- Only modify files under project/src/
- Do NOT modify project/tests/ — tests are fixed acceptance criteria
- Do NOT run tests — the harness runs them independently
- Export all functions from project/src/index.ts
`.trim(),
      { cwd: ROOT, label: 'Executor Agent' },
    )

    // Step 2: 反馈回路
    let passed = false
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const test = runTests(feature.id)
      const summary = parseTestSummary(test.output)

      if (test.pass) {
        console.log(`    ${green(`PASS`)} ${summary ? dim(summary) : ''}`)
        passed = true
        break
      }

      console.log(`    ${red(`FAIL`)} ${dim(`attempt ${attempt}/${MAX_RETRIES}`)} ${summary ? dim(summary) : ''}`)

      if (attempt < MAX_RETRIES) {
        await sendToAgent(
          `
## Test Failure — attempt ${attempt}/${MAX_RETRIES}

\`\`\`
${test.output}
\`\`\`

Analyze the root cause and fix. Do NOT modify test files.
`.trim(),
          { cwd: ROOT, resume: sessionId, label: `Fix (attempt ${attempt + 1})` },
        )
      }
    }

    // Step 3: 持久化
    feature.status = passed ? 'passing' : 'failing'
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))

    if (!passed) {
      console.log(`    ${red('GAVE UP')}`)
    }
  }

  // ── Summary ──
  const passCount = progress.features.filter((f) => f.status === 'passing').length
  const bar = progressBar(passCount, total)
  console.log(`\n  ${bar}  ${passCount}/${total} passing\n`)

  if (passCount < total) {
    const failing = progress.features.filter((f) => f.status === 'failing').map((f) => f.name)
    console.log(dim(`  Failing: ${failing.join(', ')}`))
    console.log(dim('  Re-run to retry, or `npm run reset` to start fresh.\n'))
  }
}

function progressBar(done: number, total: number, width = 20): string {
  const filled = Math.round((done / total) * width)
  const bar = green('█'.repeat(filled)) + dim('░'.repeat(width - filled))
  return `[${bar}]`
}

// ─────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()

  console.log(dim('\n  ─── Harness Demo ───\n'))

  const hasPlan =
    existsSync(PROGRESS_FILE) &&
    JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8')).features?.length > 0

  if (!hasPlan) {
    if (!task) {
      console.error('  Usage: npm start "<task description>"')
      console.error('  Example: npm start "Build a URL slug generator library"\n')
      process.exit(1)
    }
    await plan(task)
  } else if (task) {
    console.log(dim('  Progress found — resuming. Run `npm run reset` to start fresh.\n'))
  }

  await execute()
}

main().catch((err) => {
  console.error(red('  Harness error:'), err)
  process.exit(1)
})
