import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { config, WORK_DIR, PRINCIPLES_FILE } from './config.js'
import { runAgent, loadPrompt } from './agent.js'
import { sprintPath, loadSprint, tryLoadSprint, parseEvaluation } from './sprint.js'
import { dim, bold, green, red, yellow, cyan, magenta, printReview, formatReviewFeedback, progressBar } from './ui.js'
import type { ReviewResult, SingleReview } from './types.js'

// ─── JSON Schemas ───

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

function parseReview(structured: any): ReviewResult | null {
  if (structured && typeof structured === 'object' && Array.isArray(structured.reviews)) {
    const reviews = structured.reviews as ReviewResult['reviews']
    const approved = reviews.length > 0 && reviews.every((r) => r.status === 'pass')
    return { approved, reviews, overallComment: structured.overallComment ?? '' }
  }
  return null
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 0: negotiate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function negotiate(task: string, sprintNum: number, previousReview?: string): Promise<void> {
  console.log(bold(`\n  ══ NEGOTIATE — Sprint ${sprintNum} ══\n`))
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')
  const sprintFile = sprintPath(sprintNum)

  const genPrompt = previousReview
    ? loadPrompt('generator-plan-revise', {
        feedback: previousReview, evaluatorReasoning: '', task, principles,
        progressFile: sprintFile, sprintNum: String(sprintNum),
      })
    : loadPrompt('generator-plan', { task, principles, progressFile: sprintFile, sprintNum: String(sprintNum) })

  let gen = await runAgent('Generator', genPrompt)

  // 验证 sprint 文件
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
    gen = await runAgent('Generator', `The sprint file at ${sprintFile} has invalid JSON:\n\n${error}\n\nPlease read the file, fix the JSON syntax error, and write it back.`, { resume: gen.sessionId })
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

  if (!initialSprint.phase) {
    initialSprint.phase = 'negotiate'
    writeFileSync(sprintFile, JSON.stringify(initialSprint, null, 2))
  }

  // Generator ↔ Evaluator 对话协商
  let generatorSaid = gen.result
  let evalSessionId = ''

  for (let round = 1; round <= config.maxNegotiateRounds; round++) {
    const evalPrompt = loadPrompt('evaluator-plan', {
      task, principles, sprintFile, generatorResponse: generatorSaid,
    })
    const evalResult = await runAgent('Evaluator', evalPrompt, {
      outputFormat: PLAN_REVIEW_SCHEMA,
      ...(evalSessionId ? { resume: evalSessionId } : {}),
    })
    evalSessionId = evalResult.sessionId
    const { structured, result: evaluatorSaid } = evalResult

    const review = parseReview(structured)
    if (!review) {
      console.log(dim('    Could not parse review, retrying...'))
      continue
    }

    printReview(review)

    if (review.approved) {
      console.log(green(`\n  Sprint Contract agreed (round ${round})`))
      break
    }

    if (round < config.maxNegotiateRounds) {
      console.log(`\n    ${yellow('Discussion')} ${dim(`round ${round}/${config.maxNegotiateRounds}`)}`)
      const genResponse = await runAgent('Generator', loadPrompt('generator-plan-revise', {
        feedback: formatReviewFeedback(review), evaluatorReasoning: evaluatorSaid,
        task, principles, progressFile: sprintFile, sprintNum: String(sprintNum),
      }), { resume: gen.sessionId })
      generatorSaid = genResponse.result
    }
  }

  const sprint = loadSprint(sprintNum)
  console.log(green(`\n  Sprint ${sprintNum}: ${sprint.features.length} features`))
  for (const f of sprint.features) console.log(`    ${dim('·')} ${f.name}`)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 1: implement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function implement(sprintNum: number): Promise<void> {
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
      principles, featurePrompt: feature.prompt,
    }))

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
          await runAgent('Generator', loadPrompt('generator-retry', { feedback: check.output }), { resume: sessionId })
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
// Phase 2: reviewAll (N+M parallel)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function reviewAll(task: string, sprintNum: number): Promise<{ review: ReviewResult | null; collectedReview: string }> {
  console.log(bold(`\n  ══ REVIEW — Sprint ${sprintNum} ══\n`))
  const sprint = loadSprint(sprintNum)
  const principles = readFileSync(PRINCIPLES_FILE, 'utf-8')

  const reviewFns: (() => Promise<SingleReview>)[] = []

  for (const feature of sprint.features) {
    reviewFns.push(() => (async () => {
      console.log(`    ${dim('⟳')} ${dim(`reviewer: feature/${feature.id}`)}`)
      const { structured } = await runAgent('Evaluator', loadPrompt('reviewer', {
        task,
        scope: `**Feature: ${feature.id}**\n${feature.prompt}\n\nIntent: ${parseEvaluation(feature.evaluation).intent}\n\nVerify this specific feature works correctly. Run it, test edge cases, check the implementation.`,
      }), { outputFormat: SINGLE_REVIEW_SCHEMA })
      const r = structured as any ?? { status: 'needs-revision', score: 1, comment: 'Review failed to produce output' }
      return { id: feature.id, type: 'feature' as const, status: r.status, score: r.score, comment: r.comment }
    })())
  }

  for (const dimen of (sprint.reviewDimensions ?? [])) {
    reviewFns.push(() => (async () => {
      console.log(`    ${dim('⟳')} ${dim(`reviewer: dimension/${dimen.name}`)}`)
      const { structured } = await runAgent('Evaluator', loadPrompt('reviewer', {
        task,
        scope: `**Dimension: ${dimen.name}**\n${dimen.description}\n\nReview the ENTIRE implementation against this quality dimension.\n\nGolden Principles:\n${principles}`,
      }), { outputFormat: SINGLE_REVIEW_SCHEMA })
      const r = structured as any ?? { status: 'needs-revision', score: 1, comment: 'Review failed to produce output' }
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
  const review: ReviewResult = { approved, reviews: featureReviews, overallComment }

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

export async function holisticReview(task: string): Promise<{ pass: boolean; feedback: string }> {
  console.log(bold(`\n  ══ HOLISTIC REVIEW ══\n`))

  const { structured } = await runAgent('Evaluator', loadPrompt('reviewer-holistic', { task }), { outputFormat: HOLISTIC_SCHEMA })

  const result = structured as any
  if (!result || typeof result !== 'object') {
    console.log(dim('    Could not parse holistic review'))
    return { pass: false, feedback: 'Holistic review failed to produce output' }
  }

  const pass = result.status === 'pass'
  const icon = pass ? green('✓') : red('✗')
  console.log(`\n    ${icon} ${bold('Holistic verdict')}: ${result.comment?.slice(0, 150)}`)

  return { pass, feedback: result.comment ?? '' }
}
