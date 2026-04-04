import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execSync } from 'child_process'
import { config, WORK_DIR, PRINCIPLES_FILE, TOOL_DIR } from './config.js'
import { runAgent, runWithResearch, loadPrompt, RESEARCH_TOOLS, RESEARCH_COMPLETE_SCHEMA } from './agent.js'
import { sprintPath, loadSprint, tryLoadSprint, parseEvaluation } from './sprint.js'
import { dim, bold, green, red, yellow, cyan, magenta, printReview, formatReviewFeedback, progressBar } from './ui.js'
import type { ReviewResult, SingleReview } from './types.js'

// ─── JSON Schemas ───

const CONTRACT_REVIEW_SCHEMA = {
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
  const contractFormat = readFileSync(resolve(TOOL_DIR, 'control/contract-format.md'), 'utf-8')
  const sprintFile = sprintPath(sprintNum)

  const contractVars = { task, principles, contractFormat, progressFile: sprintFile, sprintNum: String(sprintNum) }

  let gen: { sessionId: string; result: string; structured?: any }

  if (previousReview) {
    // 修订轮次：research evaluator feedback → execute revisions
    const researchPrompt = loadPrompt('negotiate/generator-revise-research', { ...contractVars, feedback: previousReview, evaluatorReasoning: '' })
    const executePrompt = loadPrompt('negotiate/generator-revise-execute', contractVars)
    gen = await runWithResearch('Generator', researchPrompt, executePrompt)
  } else {
    // 首次起草：research task → execute contract writing
    const researchPrompt = loadPrompt('negotiate/generator-research', { task })
    const executePrompt = loadPrompt('negotiate/generator-execute', contractVars)
    gen = await runWithResearch('Generator', researchPrompt, executePrompt)
  }

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
    // Evaluator: research → execute
    const evalResearch = loadPrompt('negotiate/evaluator-research', {
      task, sprintFile, generatorResponse: generatorSaid,
    })
    const evalExecute = loadPrompt('negotiate/evaluator-execute', { principles })
    const evalResult = evalSessionId
      // 后续轮次：resume，只需要 research 新的 generator response
      ? await (async () => {
          console.log(dim('    [research mode]'))
          const r = await runAgent('Evaluator', evalResearch, { resume: evalSessionId, toolOverrides: RESEARCH_TOOLS, outputFormat: RESEARCH_COMPLETE_SCHEMA, silent: true })
          console.log(dim('    [execute mode]'))
          return runAgent('Evaluator', evalExecute, { resume: r.sessionId, outputFormat: CONTRACT_REVIEW_SCHEMA, silent: true })
        })()
      // 首轮：全新 session
      : await runWithResearch('Evaluator', evalResearch, evalExecute, { outputFormat: CONTRACT_REVIEW_SCHEMA })
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
      const reviseResearch = loadPrompt('negotiate/generator-revise-research', {
        ...contractVars, feedback: formatReviewFeedback(review), evaluatorReasoning: evaluatorSaid,
      })
      const reviseExecute = loadPrompt('negotiate/generator-revise-execute', contractVars)
      // resume Generator session, research → execute
      console.log(dim('    [research mode]'))
      const researchResult = await runAgent('Generator', reviseResearch, { resume: gen.sessionId, toolOverrides: RESEARCH_TOOLS, outputFormat: RESEARCH_COMPLETE_SCHEMA, silent: true })
      console.log(dim('    [execute mode]'))
      const genResponse = await runAgent('Generator', reviseExecute, { resume: researchResult.sessionId, silent: true })
      generatorSaid = genResponse.result
    }
  }

  // 协商结束后，验证 sprint 文件可读
  let finalSprint = tryLoadSprint(sprintNum)
  if (!finalSprint.sprint) {
    console.log(red(`    Sprint file has invalid JSON after negotiation: ${finalSprint.error}`))
    console.log(dim('    Asking Generator to fix...'))
    await runAgent('Generator',
      `The sprint contract at ${sprintFile} has invalid JSON:\n\n${finalSprint.error}\n\nPlease read the file, fix the JSON syntax error (common issues: unescaped backslashes or quotes inside string values), and write it back.`,
      { resume: gen.sessionId },
    )
    finalSprint = tryLoadSprint(sprintNum)
    if (!finalSprint.sprint) {
      throw new Error(`Sprint file still invalid after fix attempt: ${finalSprint.error}`)
    }
  }

  console.log(green(`\n  Sprint ${sprintNum}: ${finalSprint.sprint.features.length} features`))
  for (const f of finalSprint.sprint.features) console.log(`    ${dim('·')} ${f.name}`)
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

    const researchPrompt = loadPrompt('implement/generator-research', {
      featurePrompt: feature.prompt, background: feature.background ?? '',
    })
    const executePrompt = loadPrompt('implement/generator-execute', { principles })
    const { sessionId } = await runWithResearch('Generator', researchPrompt, executePrompt)

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
          console.log(dim('    [research mode]'))
          const retryResearch = await runAgent('Generator', loadPrompt('implement/generator-retry-research', { feedback: check.output }), { resume: sessionId, toolOverrides: RESEARCH_TOOLS, outputFormat: RESEARCH_COMPLETE_SCHEMA, silent: true })
          console.log(dim('    [execute mode]'))
          await runAgent('Generator', loadPrompt('implement/generator-retry-execute', {}), { resume: retryResearch.sessionId, silent: true })
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
      const scope = `**Feature: ${feature.id}**\n${feature.prompt}\n\nBackground: ${feature.background ?? ''}\n\nIntent: ${parseEvaluation(feature.evaluation).intent}`
      const { structured } = await runWithResearch('Evaluator',
        loadPrompt('review/reviewer-research', { task, scope }),
        loadPrompt('review/reviewer-execute', {}),
        { outputFormat: SINGLE_REVIEW_SCHEMA },
      )
      const r = structured as any ?? { status: 'needs-revision', score: 1, comment: 'Review failed to produce output' }
      return { id: feature.id, type: 'feature' as const, status: r.status, score: r.score, comment: r.comment }
    })())
  }

  for (const dimen of (sprint.reviewDimensions ?? [])) {
    reviewFns.push(() => (async () => {
      console.log(`    ${dim('⟳')} ${dim(`reviewer: dimension/${dimen.name}`)}`)
      const scope = `**Dimension: ${dimen.name}**\n${dimen.description}\n\nGolden Principles:\n${principles}`
      const { structured } = await runWithResearch('Evaluator',
        loadPrompt('review/reviewer-research', { task, scope }),
        loadPrompt('review/reviewer-execute', {}),
        { outputFormat: SINGLE_REVIEW_SCHEMA },
      )
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

  const { structured } = await runWithResearch('Evaluator',
    loadPrompt('review/holistic-research', { task }),
    loadPrompt('review/holistic-execute', {}),
    { outputFormat: HOLISTIC_SCHEMA },
  )

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
