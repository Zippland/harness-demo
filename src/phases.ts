import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { config, WORK_DIR, PRINCIPLES_FILE, TOOL_DIR, inquiryDirFor } from './config.js'
import { runAgent, loadPrompt } from './agent.js'
import { referenceFromInquiryDir, inquiryPaths, loadTask, saveTask } from './inquire.js'
import { sprintPath, loadSprint, tryLoadSprint, parseEvaluation, ensureProgressDir } from './sprint.js'
import { dim, bold, green, red, yellow, cyan, magenta, printReview, progressBar } from './ui.js'
import type { ReviewResult, SingleReview, Sprint } from './types.js'

// ─── JSON Schemas ───

const SINGLE_REVIEW_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pass', 'needs-revision'] },
      score: { type: 'number', description: '1-5 score' },
      comment: { type: 'string', description: 'Specific feedback with evidence' },
    },
    required: ['status', 'score', 'comment'],
  },
}

const NEGOTIATE_APPROVAL_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      approved: {
        type: 'boolean',
        description: 'Whether you approve the current spec.md + sprint-N.json as they exist on disk. true ends the negotiation loop.',
      },
    },
    required: ['approved'],
  },
}

const HOLISTIC_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pass', 'needs-revision'] },
      comment: { type: 'string', description: 'Specific findings with evidence. If fail: what needs a new sprint.' },
    },
    required: ['status', 'comment'],
  },
}

// ─── Helpers ───

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

async function runPool<T>(fns: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = []
  let idx = 0
  async function worker() {
    while (idx < fns.length) {
      const i = idx++
      results[i] = await fns[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, fns.length) }, () => worker()))
  return results
}

/**
 * runAgent 的封装：期望产出 structured output。
 * 如果首轮没产出，resume session 提示模型重试。最多 maxRetries 次后降级。
 */
async function runAgentExpectStructured(
  role: 'Generator' | 'Evaluator' | 'Interrogator',
  prompt: string,
  schema: any,
  opts: { silent?: boolean; maxRetries?: number; label?: string; resume?: string; appendSystemPrompt?: string } = {},
): Promise<{ sessionId: string; structured?: any; result: string }> {
  const maxRetries = opts.maxRetries ?? 2
  const label = opts.label ?? role
  let turn = await runAgent(role, prompt, {
    outputFormat: schema, silent: opts.silent,
    ...(opts.resume ? { resume: opts.resume } : {}),
    ...(opts.appendSystemPrompt ? { appendSystemPrompt: opts.appendSystemPrompt } : {}),
  })
  if (turn.structured) return turn

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`    ${yellow('!')} ${dim(`${label}: no structured output, retrying (${attempt}/${maxRetries})...`)}`)
    turn = await runAgent(role,
      'Your previous response did not include the required structured output. Please respond again using the structured JSON schema — first your free-text reply for the conversation, then the StructuredOutput tool call.',
      { resume: turn.sessionId, outputFormat: schema, silent: opts.silent },
    )
    if (turn.structured) return turn
  }
  return turn
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 0: negotiate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function negotiate(taskId: string, sprintNum: number, previousReview?: string): Promise<void> {
  console.log(bold(`\n  ══ NEGOTIATE — Sprint ${sprintNum} ══\n`))

  ensureProgressDir(taskId)
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const contractFormat = readFileSync(resolve(TOOL_DIR, 'control/contract-format.md'), 'utf-8')
  const sprintFile = sprintPath(taskId, sprintNum)
  const { specPath, sessionPath } = inquiryPaths(inquiryDirFor(taskId))

  const promptVars = {
    specPath, sessionPath, principles, contractFormat,
    progressFile: sprintFile, sprintNum: String(sprintNum),
  }
  const generatorSystemPrompt = loadPrompt('negotiate/generator-system', promptVars)
  const evaluatorSystemPrompt = loadPrompt('negotiate/evaluator-system', promptVars)

  // 加载 task —— session IDs 是 task 级状态，跨 sprint 共享。
  const task = loadTask(taskId)
  if (!task) {
    console.error(red(`\n  Task metadata missing for ${taskId} (no task.json)`))
    process.exit(1)
  }
  const t = task!

  // 加载 sprint 文件骨架（如果存在）—— 仅用于判断"是不是 mid-sprint 中断恢复"
  let sprint: Sprint | null = null
  if (existsSync(sprintFile)) {
    const loaded = tryLoadSprint(taskId, sprintNum)
    if (loaded.sprint) sprint = loaded.sprint
  }

  let generatorSessionId: string | undefined = t.negotiateGeneratorSessionId
  let evaluatorSessionId: string | undefined = t.negotiateEvaluatorSessionId

  // ─── Generator round 1 起手 ───
  // 三种情形（独立于 session 是否已存在）：
  //   a) 第一次（sprint 1，task 还没 session）：全新起手，让 Generator 读 inquiry 起草
  //   b) Mid-sprint 中断恢复（sprint 文件已存在且未完成）：让 Generator continue
  //   c) 新 sprint 但 session 已存在（sprint > 1，前一轮 review 不通过）：注入 previousReview，但延续旧 session
  let generatorMsg: string
  if (sprint && generatorSessionId) {
    console.log(dim('  Resuming mid-sprint negotiate from previous run...'))
    generatorMsg = 'Resuming. Continue refining spec.md and sprint-N.json from where you left off.'
  } else if (previousReview) {
    generatorMsg = `Sprint ${sprintNum} — a prior sprint failed review and we're re-negotiating. Address this feedback in spec.md / ${sprintFile}:\n\n${previousReview}\n\nThe previous sprint files are in progress/; you can read them to recall what was tried.`
  } else {
    generatorMsg = `Sprint ${sprintNum}. Read the inquiry session.jsonl, then draft spec.md (product narrative) and the sprint contract at ${sprintFile} (structured execution data).`
  }

  console.log(`\n  ${dim('──')} ${yellow('Generator')} ${dim('(round 1)')} ${dim('──')}`)
  let genTurn = generatorSessionId
    ? await runAgent('Generator', generatorMsg, { resume: generatorSessionId })
    : await runAgent('Generator', generatorMsg, { appendSystemPrompt: generatorSystemPrompt })
  generatorSessionId = genTurn.sessionId
  t.negotiateGeneratorSessionId = generatorSessionId
  saveTask(t)

  // 验证 Generator 创建了 sprint 文件 + 有效 JSON
  for (let fix = 0; fix < 3; fix++) {
    if (!existsSync(sprintFile)) {
      console.log(red(`    Sprint file not created at ${sprintFile} — asking Generator to create.`))
      genTurn = await runAgent('Generator',
        `You did not create the sprint contract file at ${sprintFile}. Please create it now (along with ${specPath} if not yet written).`,
        { resume: generatorSessionId },
      )
      generatorSessionId = genTurn.sessionId
      t.negotiateGeneratorSessionId = generatorSessionId
      saveTask(t)
      continue
    }
    const { sprint: s, error } = tryLoadSprint(taskId, sprintNum)
    if (s) { sprint = s; break }
    console.log(red(`    Sprint file has invalid JSON: ${error}`))
    genTurn = await runAgent('Generator',
      `The sprint file at ${sprintFile} has invalid JSON:\n\n${error}\n\nPlease read it, fix the syntax (commonly: unescaped backslashes or quotes inside string values), and write it back.`,
      { resume: generatorSessionId },
    )
    generatorSessionId = genTurn.sessionId
    t.negotiateGeneratorSessionId = generatorSessionId
    saveTask(t)
  }

  if (!sprint) {
    console.error(red(`\n  Negotiation failed: sprint file unrecoverable after retries`))
    process.exit(1)
  }
  const sp: Sprint = sprint!

  // 写回基础字段（session IDs 已上移到 task.json，此处不再存）
  if (!sp.phase) sp.phase = 'negotiate'
  if (sp.taskId !== taskId) sp.taskId = taskId
  writeFileSync(sprintFile, JSON.stringify(sp, null, 2))

  let evaluatorMsg = genTurn.result || '(Generator produced no plain-text reply this turn — please go read spec.md and sprint-N.json directly to see what was changed.)'

  // ─── Round trip 循环 ───
  for (let round = 1; round <= config.maxNegotiateRounds; round++) {
    console.log(`\n  ${dim('──')} ${magenta('Evaluator')} ${dim(`(round ${round})`)} ${dim('──')}`)

    const evalResult = await runAgentExpectStructured('Evaluator', evaluatorMsg, NEGOTIATE_APPROVAL_SCHEMA, {
      label: `Evaluator round ${round}`,
      ...(evaluatorSessionId ? { resume: evaluatorSessionId } : { appendSystemPrompt: evaluatorSystemPrompt }),
    })
    evaluatorSessionId = evalResult.sessionId
    t.negotiateEvaluatorSessionId = evaluatorSessionId
    saveTask(t)

    const approved = evalResult.structured?.approved === true
    console.log(`    ${approved ? green('✓ approved') : yellow('✗ needs-revision')}`)

    if (approved) {
      console.log(green(`\n  Sprint Contract agreed (round ${round})`))
      break
    }

    if (round >= config.maxNegotiateRounds) {
      console.error(red(`\n  Negotiation exhausted ${config.maxNegotiateRounds} rounds without approval. Manual intervention needed.`))
      process.exit(1)
    }

    // Generator 下一轮：把 Evaluator 的自由文本作为 user message 注入
    const evalText = evalResult.result || '(Evaluator produced no plain-text reply this turn — only the structured verdict.)'
    console.log(`\n  ${dim('──')} ${yellow('Generator')} ${dim(`(round ${round + 1})`)} ${dim('──')}`)
    genTurn = await runAgent('Generator', evalText, { resume: generatorSessionId })
    generatorSessionId = genTurn.sessionId
    t.negotiateGeneratorSessionId = generatorSessionId
    saveTask(t)
    evaluatorMsg = genTurn.result || '(Generator produced no plain-text reply this turn — please re-read spec.md and sprint-N.json to see what changed.)'
  }

  // 最终验证 sprint 文件可读
  const finalLoad = tryLoadSprint(taskId, sprintNum)
  if (!finalLoad.sprint) {
    throw new Error(`Sprint file invalid after negotiation: ${finalLoad.error}`)
  }

  console.log(green(`\n  Sprint ${sprintNum}: ${finalLoad.sprint.features.length} features`))
  for (const f of finalLoad.sprint.features) console.log(`    ${dim('·')} ${f.name}`)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1: implement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function implement(taskId: string, sprintNum: number): Promise<void> {
  const sprint = loadSprint(taskId, sprintNum)
  const task = loadTask(taskId)
  if (!task) {
    console.error(red(`\n  Task metadata missing for ${taskId} (no task.json)`))
    process.exit(1)
  }
  const t = task!
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const { specPath, sessionPath } = inquiryPaths(inquiryDirFor(taskId))
  const total = sprint.features.length
  const pending = sprint.features.filter((f) => f.status !== 'passing')

  console.log(bold(`\n  ══ IMPLEMENT — Sprint ${sprintNum} ══  ${pending.length} features\n`))

  // implement 阶段所有 sprint × 所有 feature 共享同一个 Generator session：
  //   - 人格/约束/principles/inquiry 路径沉到 systemPrompt（永驻、不被 compact）
  //   - Session 生命周期锚定在 task 级（task.implementSessionId），跨 sprint 延续
  //   - SDK auto-compact 管理上下文滚动
  //   - spec.md / session.jsonl 只传路径，prompt 自己写"按需 Read"的说明
  const systemPrompt = loadPrompt('implement/generator-system', { principles, specPath, sessionPath })
  let sharedSessionId: string | undefined = t.implementSessionId

  for (let i = 0; i < sprint.features.length; i++) {
    const feature = sprint.features[i]

    if (feature.status === 'passing') {
      console.log(`  ${dim(`[${i + 1}/${total}]`)} ${dim(feature.name)} ${green('done')}`)
      continue
    }

    console.log(`\n  ${bold(`[${i + 1}/${total}]`)} ${bold(feature.name)}`)

    const prompt = loadPrompt('implement/generator-feature', {
      featurePrompt: feature.prompt, background: feature.background ?? '',
    })
    const opts = sharedSessionId
      ? { resume: sharedSessionId }
      : { appendSystemPrompt: systemPrompt }
    const featureResult = await runAgent('Generator', prompt, opts)
    sharedSessionId = featureResult.sessionId

    if (t.implementSessionId !== sharedSessionId) {
      t.implementSessionId = sharedSessionId
      saveTask(t)
    }

    const eval_ = parseEvaluation(feature.evaluation)
    let passed = false

    if (eval_.checks.length === 0) {
      passed = true
    } else {
      for (let attempt = 1; attempt <= config.maxL1Retries; attempt++) {
        const check = runChecks(eval_.checks)
        if (check.pass) {
          console.log(`    ${green('L1 PASS')}`)
          passed = true
          break
        }
        console.log(`    ${red('L1 FAIL')} ${dim(`attempt ${attempt}/${config.maxL1Retries}`)}`)
        if (attempt < config.maxL1Retries) {
          console.log(`\n  ${dim('──')} ${yellow('Generator')} ${dim('──')}`)
          const retryResult = await runAgent('Generator', loadPrompt('implement/generator-retry', { feedback: check.output }), { resume: sharedSessionId, silent: true })
          sharedSessionId = retryResult.sessionId
          if (t.implementSessionId !== sharedSessionId) {
            t.implementSessionId = sharedSessionId
            saveTask(t)
          }
        }
      }
    }

    feature.status = passed ? 'passing' : 'failing'
    writeFileSync(sprintPath(taskId, sprintNum), JSON.stringify(sprint, null, 2))
    if (!passed) console.log(`    ${red('L1 gave up')}`)
  }

  const passCount = sprint.features.filter((f) => f.status === 'passing').length
  console.log(`\n  ${progressBar(passCount, total)}  L1: ${passCount}/${total}\n`)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 2: reviewAll (N+M parallel)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function reviewAll(taskId: string, sprintNum: number): Promise<{ review: ReviewResult | null; collectedReview: string }> {
  console.log(bold(`\n  ══ REVIEW — Sprint ${sprintNum} ══\n`))
  const sprint = loadSprint(taskId, sprintNum)
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const inquiryReference = referenceFromInquiryDir(inquiryDirFor(taskId))

  const reviewFns: (() => Promise<SingleReview>)[] = []

  for (const feature of sprint.features) {
    reviewFns.push(() => (async () => {
      console.log(`    ${dim('⟳')} ${dim(`reviewer: feature/${feature.id}`)}`)
      const scope = `**Feature: ${feature.id}**\n${feature.prompt}\n\nBackground: ${feature.background ?? ''}\n\nIntent: ${parseEvaluation(feature.evaluation).intent}`
      const { structured } = await runAgentExpectStructured('Evaluator',
        loadPrompt('review/reviewer', { scope, inquiryReference }),
        SINGLE_REVIEW_SCHEMA,
        { silent: true, label: `feature/${feature.id}` },
      )
      const r = structured ?? { status: 'needs-revision', score: 1, comment: 'Review failed to produce structured output after retries' }
      return { id: feature.id, type: 'feature' as const, status: r.status, score: r.score, comment: r.comment }
    })())
  }

  for (const dimen of (sprint.reviewDimensions ?? [])) {
    reviewFns.push(() => (async () => {
      console.log(`    ${dim('⟳')} ${dim(`reviewer: dimension/${dimen.name}`)}`)
      const scope = `**Dimension: ${dimen.name}**\n${dimen.description}\n\nGolden Principles:\n${principles}`
      const { structured } = await runAgentExpectStructured('Evaluator',
        loadPrompt('review/reviewer', { scope, inquiryReference }),
        SINGLE_REVIEW_SCHEMA,
        { silent: true, label: `dimension/${dimen.name}` },
      )
      const r = structured ?? { status: 'needs-revision', score: 1, comment: 'Review failed to produce structured output after retries' }
      return { id: dimen.name, type: 'dimension' as const, status: r.status, score: r.score, comment: r.comment }
    })())
  }

  const results = await runPool(reviewFns, config.concurrency)

  console.log()
  for (const r of results) {
    const icon = r.status === 'pass' ? green('✓') : red('✗')
    const tag = r.type === 'feature' ? cyan('feature') : magenta('dimension')
    console.log(`    ${icon} ${tag}/${bold(r.id)} ${dim(`[${r.score}/5]`)} ${dim(r.comment.slice(0, 80))}`)
  }

  const featureReviews = results.filter((r) => r.type === 'feature').map((r) => ({ featureId: r.id, status: r.status, comment: r.comment }))
  const dimensionReviews = results.filter((r) => r.type === 'dimension')
  const approved = results.every((r) => r.status === 'pass')
  const overallComment = dimensionReviews.map((r) => `[${r.id}: ${r.score}/5] ${r.comment}`).join('\n')
  const review: ReviewResult = {
    approved,
    reviews: featureReviews,
    dimensionReviews: dimensionReviews.map((r) => ({ id: r.id, status: r.status, comment: r.comment })),
    overallComment,
  }

  const collectedReview = [
    '# Review Results', '',
    '## Feature Reviews',
    ...results.filter((r) => r.type === 'feature').map((r) => `- [${r.status === 'pass' ? 'PASS' : 'NEEDS-REVISION'}] **${r.id}** (${r.score}/5): ${r.comment}`),
    '', '## Dimension Reviews',
    ...results.filter((r) => r.type === 'dimension').map((r) => `- [${r.status === 'pass' ? 'PASS' : 'NEEDS-REVISION'}] **${r.id}** (${r.score}/5): ${r.comment}`),
    '', `## Verdict: ${approved ? 'ALL PASS' : 'NEEDS REVISION'}`,
  ].join('\n')

  printReview(review)
  return { review, collectedReview }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3: holisticReview
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function holisticReview(taskId: string): Promise<{ pass: boolean; feedback: string }> {
  console.log(bold(`\n  ══ HOLISTIC REVIEW ══\n`))
  const inquiryReference = referenceFromInquiryDir(inquiryDirFor(taskId))

  const { structured } = await runAgentExpectStructured('Evaluator',
    loadPrompt('review/holistic', { inquiryReference }),
    HOLISTIC_SCHEMA,
    { label: 'holistic' },
  )

  const result = structured
  if (!result || typeof result !== 'object') {
    console.log(dim('    Could not parse holistic review after retries'))
    return { pass: false, feedback: 'Holistic review failed to produce structured output' }
  }

  const pass = result.status === 'pass'
  const icon = pass ? green('✓') : red('✗')
  console.log(`\n    ${icon} ${bold('Holistic verdict')}: ${result.comment?.slice(0, 150)}`)

  return { pass, feedback: result.comment ?? '' }
}
