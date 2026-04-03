/**
 * Harness — Generator ↔ Evaluator 对抗架构
 *
 * 每轮 Sprint 产生独立的 sprint-N.json，不修改历史记录。
 *
 * 大循环：
 *   Sprint 1: negotiate → implement(L1) → review
 *   Sprint 2: negotiate(review feedback) → implement(L1) → review
 *   ...直到 review approved 或达到上限
 *
 * npm start "构建一个 URL 解析库"
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { resolve, dirname, relative } from 'path'
import { fileURLToPath } from 'url'

// ─── Paths & Config ───

const TOOL_DIR = dirname(fileURLToPath(import.meta.url))  // harness 工具自身的文件
const WORK_DIR = process.cwd()                             // 用户的工作目录
const PROGRESS_DIR = resolve(WORK_DIR, '.harness/progress')
const LOCAL_PRINCIPLES = resolve(WORK_DIR, '.harness/golden-principles.md')
const DEFAULT_PRINCIPLES = resolve(TOOL_DIR, 'control/golden-principles.md')
const PRINCIPLES_FILE = existsSync(LOCAL_PRINCIPLES) ? LOCAL_PRINCIPLES : DEFAULT_PRINCIPLES
const PROMPTS_DIR = resolve(TOOL_DIR, 'prompts')
const MAX_L1_RETRIES = 5
const MAX_NEGOTIATE_ROUNDS = 30
const MAX_SPRINTS = 10

// ─── Types ───

type Role = 'Generator' | 'Evaluator'

interface Evaluation {
  checks: string[]
  intent: string
}

interface Feature {
  id: string
  name: string
  prompt: string
  evaluation: Evaluation | string
  status: 'pending' | 'failing' | 'passing'
}

interface ReviewDimension {
  name: string
  description: string
}

interface Sprint {
  sprint: number
  task: string
  phase: 'negotiate' | 'implement' | 'review' | 'done'
  reviewDimensions: ReviewDimension[]
  context?: string
  previousReview?: string
  features: Feature[]
}

interface ReviewResult {
  approved: boolean  // orchestrator 计算，不来自 Evaluator
  reviews: { featureId: string; status: string; comment: string }[]
  overallComment: string
}

// ─── Sprint file helpers ───

function sprintPath(n: number): string {
  return resolve(PROGRESS_DIR, `sprint-${n}.json`)
}

function loadSprint(n: number): Sprint {
  return JSON.parse(readFileSync(sprintPath(n), 'utf-8'))
}

function tryLoadSprint(n: number): { sprint: Sprint | null; error: string } {
  try {
    return { sprint: loadSprint(n), error: '' }
  } catch (e) {
    return { sprint: null, error: (e as Error).message }
  }
}

function currentSprintNumber(): number {
  if (!existsSync(PROGRESS_DIR)) return 0
  const files = readdirSync(PROGRESS_DIR).filter((f) => /^sprint-\d+\.json$/.test(f))
  if (files.length === 0) return 0
  return Math.max(...files.map((f) => parseInt(f.match(/\d+/)![0])))
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
  Generator: yellow,
  Evaluator: magenta,
}

function shortPath(p: string): string {
  if (!p) return ''
  return relative(WORK_DIR, p.startsWith('/') ? p : resolve(WORK_DIR, p)) || p
}

// ─── Agent 工具权限 ───

const AGENT_CONFIG: Record<Role, Record<string, any>> = {
  Generator: {
    model: 'claude-sonnet-4-6',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  },
  Evaluator: {
    model: 'claude-sonnet-4-6',
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    disallowedTools: ['Write', 'Edit'],
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
      cwd: WORK_DIR,
      permissionMode: 'acceptEdits' as const,
      ...AGENT_CONFIG[role],
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
    },
  })

  let sessionId = ''
  let result = ''
  let structured: any
  const textBlocks: string[] = []

  try {
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of ((msg as any).message?.content ?? [])) {
          if (block.type === 'text' && block.text?.trim()) {
            const text = block.text.trim()
            textBlocks.push(text)
            for (const line of text.split('\n')) {
              console.log(`    ${cyan('>')} ${line}`)
            }
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
  } catch (e: any) {
    const errMsg = String(e?.message ?? e)
    if (errMsg.includes('output token') && sessionId) {
      // token 超限：resume 让 agent 继续完成
      console.log(`    ${yellow('!')} ${dim('Output token limit hit, resuming...')}`)
      return runAgent(role, 'Continue where you left off. Complete your remaining work.', { ...opts, resume: sessionId })
    }
    throw e
  }

  const joined = textBlocks.join('\n\n') || result
  const fullResponse = joined.length > 5000 ? joined.slice(-5000) : joined

  return { sessionId, result: fullResponse, structured }
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 0: negotiate — Sprint Contract 协商
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// negotiate 阶段用：审计划
const PLAN_REVIEW_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            featureId: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'needs-revision'] },
            comment: { type: 'string', description: 'Always provide a comment, even if passing' },
          },
          required: ['featureId', 'status', 'comment'],
        },
      },
      overallComment: { type: 'string', description: 'Cross-cutting concerns, missing features, architectural issues' },
    },
    required: ['reviews', 'overallComment'],
  },
}

// review 阶段用：审实现，按协商好的维度评分
const IMPL_REVIEW_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            featureId: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'needs-revision'] },
            scores: {
              type: 'object',
              description: 'Score each dimension from the sprint file reviewDimensions (1-5). Keys must match dimension names.',
            },
            comment: { type: 'string', description: 'Specific feedback with evidence from your verification' },
          },
          required: ['featureId', 'status', 'scores', 'comment'],
        },
      },
      overallComment: { type: 'string', description: 'Cross-cutting concerns, coherence, architectural issues' },
    },
    required: ['reviews', 'overallComment'],
  },
}

async function negotiate(task: string, sprintNum: number, previousReview?: string, evalSessionFromReview?: string): Promise<void> {
  console.log(bold(`\n  ══ NEGOTIATE — Sprint ${sprintNum} ══\n`))
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const sprintFile = sprintPath(sprintNum)

  // Generator 提出/修订计划
  const genPrompt = previousReview
    ? loadPrompt('generator-plan-revise', {
        feedback: previousReview,
        evaluatorReasoning: '',
        task,
        principles,
        progressFile: sprintFile,
        sprintNum: String(sprintNum),
      })
    : loadPrompt('generator-plan', { task, principles, progressFile: sprintFile, sprintNum: String(sprintNum) })

  let gen = await runAgent('Generator', genPrompt)

  // 验证 sprint 文件存在且是合法 JSON，失败则让 Generator 修
  for (let fix = 0; fix < 3; fix++) {
    if (!existsSync(sprintFile)) {
      console.log(red(`    Sprint file not created, asking Generator to retry`))
      gen = await runAgent('Generator', `You did not create the sprint file at ${sprintFile}. Please create it now.`, { resume: gen.sessionId })
      continue
    }
    const { sprint, error } = tryLoadSprint(sprintNum)
    if (sprint) break
    console.log(red(`    Sprint file has invalid JSON: ${error}`))
    console.log(dim('    Asking Generator to fix...'))
    gen = await runAgent('Generator', `The sprint file at ${sprintFile} has invalid JSON:\n\n${error}\n\nPlease read the file, fix the JSON syntax error, and write it back. Common issue: unescaped quotes inside string values.`, { resume: gen.sessionId })
  }

  if (!existsSync(sprintFile)) {
    console.error(red(`\n  Negotiation failed: ${sprintFile} not created after retries`))
    process.exit(1)
  }

  const { sprint: initialSprint, error } = tryLoadSprint(sprintNum)
  if (!initialSprint) {
    console.error(red(`\n  Negotiation failed: ${sprintFile} still invalid: ${error}`))
    process.exit(1)
  }

  // 确保 sprint 文件有 phase 字段
  if (!initialSprint.phase) {
    initialSprint.phase = 'negotiate'
    writeFileSync(sprintFile, JSON.stringify(initialSprint, null, 2))
  }

  // Generator ↔ Evaluator 对话协商
  // 双方各自顺承（resume），保持对话上下文
  let generatorSaid = gen.result
  let evalSessionId = evalSessionFromReview ?? ''

  for (let round = 1; round <= MAX_NEGOTIATE_ROUNDS; round++) {
    // Evaluator 审计划 + 读 Generator 的文字回复（同一 session 顺承）
    const evalPrompt = loadPrompt('evaluator-plan', {
      task,
      principles,
      sprintFile,
      generatorResponse: generatorSaid,
    })
    const evalResult = await runAgent('Evaluator', evalPrompt, {
      outputFormat: PLAN_REVIEW_SCHEMA,
      ...(evalSessionId ? { resume: evalSessionId } : {}),
    })
    evalSessionId = evalResult.sessionId
    const { structured, result: evaluatorSaid } = evalResult

    const review = parseReview(structured)
    if (!review) {
      console.log(dim('    Could not parse review, proceeding'))
      break
    }

    printReview(review)

    if (review.approved) {
      console.log(green(`\n  Sprint Contract agreed (round ${round})`))
      break
    }

    if (round < MAX_NEGOTIATE_ROUNDS) {
      console.log(`\n    ${yellow('Discussion')} ${dim(`round ${round}/${MAX_NEGOTIATE_ROUNDS}`)}`)
      // Generator 收到 Evaluator 的完整回复（评论 + 文字论述）
      // Generator 可以选择：argue back（只说话）或 agree（改文件）
      const genResponse = await runAgent('Generator', loadPrompt('generator-plan-revise', {
        feedback: formatReviewFeedback(review),
        evaluatorReasoning: evaluatorSaid,
        task,
        principles,
        progressFile: sprintFile,
        sprintNum: String(sprintNum),
      }), { resume: gen.sessionId })

      generatorSaid = genResponse.result
    }
  }

  const sprint = loadSprint(sprintNum)
  console.log(green(`\n  Sprint ${sprintNum}: ${sprint.features.length} features`))
  for (const f of sprint.features) console.log(`    ${dim('·')} ${f.name}`)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1: implement — Generator + L1 only
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function implement(sprintNum: number): Promise<void> {
  const sprint = loadSprint(sprintNum)
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const total = sprint.features.length
  const pending = sprint.features.filter((f) => f.status !== 'passing')

  console.log(bold(`\n  ══ IMPLEMENT — Sprint ${sprintNum} ══  ${pending.length} features\n`))

  for (let i = 0; i < sprint.features.length; i++) {
    const feature = sprint.features[i]

    if (feature.status === 'passing') {
      console.log(`  ${dim(`[${i + 1}/${total}]`)} ${dim(feature.name)} ${green('done')}`)
      continue
    }

    console.log(`\n  ${bold(`[${i + 1}/${total}]`)} ${bold(feature.name)}`)

    const { sessionId } = await runAgent('Generator', loadPrompt('generator', {
      principles,
      featurePrompt: feature.prompt,
    }))

    // L1 确定性检查
    const eval_ = parseEvaluation(feature.evaluation)
    let passed = false

    if (eval_.checks.length === 0) {
      passed = true
    } else {
      for (let attempt = 1; attempt <= MAX_L1_RETRIES; attempt++) {
        const check = runChecks(eval_.checks)

        if (check.pass) {
          console.log(`    ${green('L1 PASS')}`)
          passed = true
          break
        }

        console.log(`    ${red('L1 FAIL')} ${dim(`attempt ${attempt}/${MAX_L1_RETRIES}`)}`)

        if (attempt < MAX_L1_RETRIES) {
          await runAgent('Generator', loadPrompt('generator-retry', {
            feedback: check.output,
          }), { resume: sessionId })
        }
      }
    }

    feature.status = passed ? 'passing' : 'failing'
    writeFileSync(sprintPath(sprintNum), JSON.stringify(sprint, null, 2))
    if (!passed) console.log(`    ${red('L1 gave up')}`)
  }

  const passCount = sprint.features.filter((f) => f.status === 'passing').length
  console.log(`\n  ${progressBar(passCount, total)}  L1: ${passCount}/${total}\n`)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 2: reviewAll — Evaluator 全局审查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function reviewAll(task: string, sprintNum: number): Promise<{ review: ReviewResult | null; evalSessionId: string }> {
  console.log(bold(`\n  ══ REVIEW — Sprint ${sprintNum} ══\n`))
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')

  const { structured, sessionId } = await runAgent('Evaluator', loadPrompt('evaluator-review', {
    task,
    principles,
    sprintFile: sprintPath(sprintNum),
  }), { outputFormat: IMPL_REVIEW_SCHEMA })

  const review = parseReview(structured)
  if (!review) {
    console.log(dim('    Could not parse review'))
    return { review: null, evalSessionId: sessionId }
  }

  printReview(review)
  return { review, evalSessionId: sessionId }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// L1: 确定性检查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseEvaluation(evaluation: Evaluation | string | undefined): Evaluation {
  if (!evaluation) return { checks: [], intent: '' }
  if (typeof evaluation === 'string') return { checks: [], intent: evaluation }
  return evaluation
}

function runChecks(checks: string[]): { pass: boolean; output: string } {
  const results: string[] = []
  for (const cmd of checks) {
    console.log(`    ${dim('$')} ${dim(cmd.slice(0, 100))}`)
    try {
      execSync(cmd, { cwd: WORK_DIR, encoding: 'utf-8', timeout: 60_000, stdio: ['pipe', 'pipe', 'pipe'] })
      results.push(`✓ ${cmd}`)
    } catch (e: any) {
      const output = ((e.stdout ?? '') + (e.stderr ?? '')).trim()
      const tail = output.length > 1500 ? '...\n' + output.slice(-1500) : output
      console.log(`    ${red('✗')} ${dim('check failed')}`)
      return { pass: false, output: `Command failed: ${cmd}\n\n${tail}` }
    }
  }
  if (results.length > 0) {
    console.log(`    ${green('✓')} ${dim(`${results.length} checks passed`)}`)
  }
  return { pass: true, output: results.join('\n') }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Review helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseReview(structured: any): ReviewResult | null {
  if (structured && typeof structured === 'object' && Array.isArray(structured.reviews)) {
    const reviews = structured.reviews as ReviewResult['reviews']
    // approved 由 orchestrator 机械判定：全部 pass 才通过
    const approved = reviews.length > 0 && reviews.every((r) => r.status === 'pass')
    return {
      approved,
      reviews,
      overallComment: structured.overallComment ?? '',
    }
  }
  return null
}

function printReview(review: ReviewResult): void {
  for (const r of review.reviews ?? []) {
    const icon = r.status === 'pass' ? green('✓') : red('✗')
    const scores = (r as any).scores
    const scoreStr = scores
      ? dim(' [' + Object.entries(scores).map(([k, v]) => `${k}:${v}`).join(' ') + ']')
      : ''
    console.log(`    ${icon} ${bold(r.featureId)}${scoreStr} ${dim(r.comment.slice(0, 80))}`)
  }
  if (review.overallComment) {
    console.log(`    ${dim('Overall:')} ${dim(review.overallComment.slice(0, 150))}`)
  }
}

function formatReviewFeedback(review: ReviewResult): string {
  const lines = (review.reviews ?? [])
    .filter((r) => r.status === 'needs-revision')
    .map((r) => `- **${r.featureId}**: ${r.comment}`)
  return [
    ...lines,
    review.overallComment ? `\n**Overall**: ${review.overallComment}` : '',
  ].join('\n')
}

function formatReviewForDiscussion(review: ReviewResult): string {
  const lines = (review.reviews ?? []).map((r) => {
    const tag = r.status === 'pass' ? '✓ PASS' : '✗ DISPUTE'
    return `- [${tag}] **${r.featureId}**: ${r.comment}`
  })
  return [
    '# Evaluator Review Results',
    '',
    'The Evaluator has reviewed the implementation. Items marked DISPUTE are open for discussion.',
    'You may agree (and plan a fix in the next sprint) or disagree (and argue why it\'s correct).',
    '',
    'Create a new sprint file with ONLY the features that need rework or are newly added.',
    'Do NOT include features that are already passing and not under dispute.',
    '',
    ...lines,
    review.overallComment ? `\n**Overall**: ${review.overallComment}` : '',
  ].join('\n')
}

function progressBar(done: number, total: number, width = 20): string {
  const filled = Math.round((done / total) * width)
  return `[${green('█'.repeat(filled))}${dim('░'.repeat(width - filled))}]`
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main — Sprint 大循环
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 更新 sprint 文件的 phase 和 previousReview */
function updateSprintState(sprintNum: number, phase: Sprint['phase'], previousReview?: string): void {
  const file = sprintPath(sprintNum)
  if (!existsSync(file)) return
  const sprint = loadSprint(sprintNum)
  sprint.phase = phase
  if (previousReview !== undefined) sprint.previousReview = previousReview
  writeFileSync(file, JSON.stringify(sprint, null, 2))
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()

  // 提高输出 token 上限
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000'

  // 在工作目录创建 .harness/progress
  mkdirSync(PROGRESS_DIR, { recursive: true })

  const existingSprint = currentSprintNumber()

  if (!task && existingSprint === 0) {
    console.error('  Usage: harness "<task description>"')
    process.exit(1)
  }

  console.log(dim('\n  ─── Harness: Generator ↔ Evaluator ───\n'))

  // 断点恢复：检查上一个 sprint 是否完成
  let startSprint = existingSprint + 1
  let previousReview: string | undefined

  if (existingSprint > 0) {
    const lastSprint = loadSprint(existingSprint)
    if (lastSprint.phase !== 'done') {
      // 上一个 sprint 没跑完，从它的当前 phase 继续
      startSprint = existingSprint
      previousReview = lastSprint.previousReview
      const taskFromFile = lastSprint.task
      if (!task && taskFromFile) {
        // 用 sprint 文件里的 task（不需要用户重新输入）
        console.log(dim(`  Resuming sprint ${existingSprint} (phase: ${lastSprint.phase})\n`))
      }
    } else {
      previousReview = lastSprint.previousReview
    }
  }

  const resolvedTask = task || (existingSprint > 0 ? loadSprint(existingSprint).task : '')
  let evalSessionFromLastReview: string | undefined

  for (let sprintNum = startSprint; sprintNum <= startSprint + MAX_SPRINTS; sprintNum++) {
    console.log(bold(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━`))
    console.log(bold(`       Sprint ${sprintNum}`))
    console.log(bold(`  ━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

    // 断点恢复：跳过已完成的 phase
    const resumePhase = (sprintNum === startSprint && existingSprint > 0 && existsSync(sprintPath(sprintNum)))
      ? loadSprint(sprintNum).phase
      : null

    // Phase 0: 协商（传入上一轮 review 的 Evaluator session，保持对话连续）
    if (!resumePhase || resumePhase === 'negotiate') {
      await negotiate(resolvedTask, sprintNum, previousReview, evalSessionFromLastReview)
      updateSprintState(sprintNum, 'implement')
    }

    // Phase 1: 实现 + L1
    if (!resumePhase || resumePhase === 'negotiate' || resumePhase === 'implement') {
      await implement(sprintNum)
      updateSprintState(sprintNum, 'review')
    }

    // Phase 2: 全局审查
    const { review, evalSessionId } = await reviewAll(resolvedTask, sprintNum)

    if (!review || review.approved) {
      updateSprintState(sprintNum, 'done')
      let totalFeatures = 0
      for (let s = 1; s <= sprintNum; s++) {
        if (existsSync(sprintPath(s))) totalFeatures += loadSprint(s).features.length
      }
      console.log(green(bold(`\n  ✓ ALL APPROVED after ${sprintNum} sprint(s) — ${totalFeatures} features total\n`)))
      break
    }

    // 有分歧 → Evaluator session 传给下一轮 negotiate
    evalSessionFromLastReview = evalSessionId
    previousReview = formatReviewForDiscussion(review)
    updateSprintState(sprintNum, 'done', previousReview)

    const disputeCount = (review.reviews ?? []).filter((r) => r.status === 'needs-revision').length
    console.log(yellow(`\n  ${disputeCount} features under dispute → Sprint ${sprintNum + 1}\n`))
  }
}

main().catch((e) => { console.error(red('  Error:'), e); process.exit(1) })
