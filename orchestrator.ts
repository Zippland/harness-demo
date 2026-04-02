/**
 * Harness — Generator ↔ Evaluator 对抗架构
 *
 * 三个 Agent，各自看到不同的工具集：
 *   Planner:   Read, Write, Glob, Grep, Bash    → 调研 + 拆任务 + 写测试
 *   Generator: Read, Write, Edit, Glob, Grep, Bash → 实现代码
 *   Evaluator: Read, Glob, Grep, Bash            → 跑测试 + 审代码（不能写文件）
 *
 * Prompt 模板在 prompts/ 目录下，用 {{var}} 占位符。
 *
 * npm start "构建一个 URL 解析库"
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

// ─── Paths & Config ───

const ROOT = dirname(fileURLToPath(import.meta.url))
const PROGRESS_FILE = resolve(ROOT, 'progress.json')
const PRINCIPLES_FILE = resolve(ROOT, 'control/golden-principles.md')
const PROMPTS_DIR = resolve(ROOT, 'prompts')
const MAX_RETRIES = 5

// ─── Types ───

type Role = 'Planner' | 'Generator' | 'Evaluator'

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

interface EvalResult {
  passed: boolean
  tests: string
  feedback: string
}

// ─── Prompt loader ───

function loadPrompt(name: string, vars: Record<string, string>): string {
  const tmpl = readFileSync(resolve(PROMPTS_DIR, `${name}.md`), 'utf-8')
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// ─── ANSI ───

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

const ROLE_STYLE: Record<Role, (s: string) => string> = {
  Planner: cyan,
  Generator: yellow,
  Evaluator: magenta,
}

function shortPath(p: string): string {
  if (!p) return ''
  return relative(ROOT, p.startsWith('/') ? p : resolve(ROOT, p)) || p
}

// ─── 每个 Agent 的工具权限 ───

const AGENT_CONFIG: Record<Role, Record<string, any>> = {
  Planner: {
    allowedTools: ['Read', 'Write', 'Glob', 'Grep', 'Bash'],
    disallowedTools: ['Edit'],
    maxTurns: 30,
  },
  Generator: {
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    maxTurns: 30,
  },
  Evaluator: {
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    disallowedTools: ['Write', 'Edit'],
    maxTurns: 10,
  },
}

// ─── Agent Runner ───

async function runAgent(
  role: Role,
  prompt: string,
  opts: { resume?: string; outputFormat?: any } = {},
): Promise<{ sessionId: string; result: string; structured?: any }> {
  const color = ROLE_STYLE[role]
  console.log(`\n  ${dim('──')} ${color(role)} ${dim('──')}`)

  const q = query({
    prompt,
    options: {
      cwd: ROOT,
      permissionMode: 'acceptEdits' as const,
      ...AGENT_CONFIG[role],
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
    },
  })

  let sessionId = ''
  let result = ''
  let structured: any

  for await (const msg of q) {
    if (msg.type === 'assistant') {
      for (const block of ((msg as any).message?.content ?? [])) {
        if (block.type === 'text' && block.text?.trim()) {
          const text = block.text.trim().replace(/\n/g, ' ').slice(0, 150)
          console.log(`    ${cyan('>')} ${text}`)
        }
        if (block.type === 'tool_use') {
          logTool(block.name, block.input)
        }
      }
    }
    if ('session_id' in msg && (msg as any).session_id) {
      sessionId = (msg as any).session_id
    }
    if (msg.type === 'result' && (msg as any).subtype === 'success') {
      result = (msg as any).result ?? ''
      structured = (msg as any).structured_output
    }
  }

  return { sessionId, result, structured }
}

function logTool(name: string, input: any): void {
  const fmts: Record<string, () => string> = {
    Read:  () => `${cyan('Read')}  ${shortPath(input?.file_path)}`,
    Write: () => `${yellow('Write')} ${shortPath(input?.file_path)}`,
    Edit:  () => `${yellow('Edit')}  ${shortPath(input?.file_path)}`,
    Bash:  () => `${dim('$')} ${dim((input?.command ?? '').slice(0, 100))}`,
    Glob:  () => `${cyan('Glob')}  ${input?.pattern ?? ''}`,
    Grep:  () => `${cyan('Grep')}  "${(input?.pattern ?? '').slice(0, 60)}"`,
  }
  console.log(`    ${(fmts[name] ?? (() => cyan(name)))()}`)
}

// ─── Phase 0: Planner ───

async function plan(task: string): Promise<void> {
  console.log(bold(`\n  PLAN: "${task}"\n`))
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')

  await runAgent('Planner', loadPrompt('planner', {
    task,
    principles,
    progressFile: PROGRESS_FILE,
  }))

  if (!existsSync(PROGRESS_FILE)) {
    console.error(red('\n  Plan failed: progress.json not created'))
    process.exit(1)
  }

  const progress: Progress = JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8'))
  console.log(green(`\n  Plan: ${progress.features.length} features`))
  for (const f of progress.features) console.log(`    ${dim('·')} ${f.name}`)
}

// ─── Phase 1: Generator ↔ Evaluator ───

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

    // Generator: 首次实现
    const { sessionId } = await runAgent('Generator', loadPrompt('generator', {
      principles,
      featurePrompt: feature.prompt,
    }))

    // Evaluate → (fail?) → Feed back → Re-generate → Evaluate
    let passed = false

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const evalResult = await evaluate(feature, principles)

      if (evalResult.passed) {
        console.log(`    ${green('PASS')} ${dim(evalResult.tests)}`)
        passed = true
        break
      }

      console.log(`    ${red('FAIL')} ${dim(`attempt ${attempt}/${MAX_RETRIES}`)} ${dim(evalResult.tests)}`)

      if (attempt < MAX_RETRIES) {
        await runAgent('Generator', loadPrompt('generator-retry', {
          feedback: evalResult.feedback,
        }), { resume: sessionId })
      }
    }

    feature.status = passed ? 'passing' : 'failing'
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
    if (!passed) console.log(`    ${red('GAVE UP')}`)
  }

  const passCount = progress.features.filter((f) => f.status === 'passing').length
  const filled = Math.round((passCount / total) * 20)
  console.log(`\n  [${green('█'.repeat(filled))}${dim('░'.repeat(20 - filled))}]  ${passCount}/${total} passing\n`)
}

// ─── Evaluator ───

const EVAL_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      passed: { type: 'boolean', description: 'true only if ALL tests pass AND code follows golden principles' },
      tests: { type: 'string', description: 'e.g. "4 passed, 0 failed"' },
      feedback: { type: 'string', description: 'If failed: what is wrong, which tests fail, how to fix. Cite file paths and line numbers.' },
    },
    required: ['passed', 'tests', 'feedback'],
  },
}

async function evaluate(feature: Feature, principles: string): Promise<EvalResult> {
  const { structured, result } = await runAgent('Evaluator', loadPrompt('evaluator', {
    featureId: feature.id,
    featurePrompt: feature.prompt,
    principles,
  }), { outputFormat: EVAL_SCHEMA })

  if (structured && typeof structured === 'object' && 'passed' in structured) {
    return structured as EvalResult
  }
  return parseEvalText(result)
}

function parseEvalText(text: string): EvalResult {
  const m = text.match(/\{[\s\S]*?"passed"[\s\S]*?\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return { passed: !/fail/i.test(text), tests: '', feedback: text.slice(0, 500) }
}

// ─── Main ───

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()

  console.log(dim('\n  ─── Harness: Planner → Generator ↔ Evaluator ───\n'))

  const hasPlan = existsSync(PROGRESS_FILE) &&
    JSON.parse(readFileSync(PROGRESS_FILE, 'utf-8')).features?.length > 0

  if (!hasPlan) {
    if (!task) {
      console.error('  Usage: npm start "<task description>"')
      process.exit(1)
    }
    await plan(task)
  } else if (task) {
    console.log(dim('  Progress found — resuming. `npm run reset` to start fresh.\n'))
  }

  await execute()
}

main().catch((e) => { console.error(red('  Error:'), e); process.exit(1) })
