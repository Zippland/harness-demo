/**
 * Harness — Generator ↔ Evaluator 对抗架构
 *
 * 两阶段：
 *   harness discover "<task>"  —— live: 和 Interrogator 对话，产出 pending
 *   harness execute [task-id]   —— autonomous: 读 pending，跑 sprint 大循环
 *
 * Sprint 大循环：negotiate → implement(L1) → review(N+M) → holistic
 *
 *   harness "<task>"           — 语法糖：discover 然后 execute
 *   harness execute --direct "<task>"   — 熟练用户：跳过 discovery
 *   harness                    — 断点恢复或列 pending
 *   harness onboard            — 交互式配置
 */

import { existsSync, mkdirSync } from 'fs'
import { config, PROGRESS_DIR } from './src/config.js'
import { sprintPath, loadSprint, currentSprintNumber, updateSprintState } from './src/sprint.js'
import { startLiteLLM } from './src/litellm.js'
import { onboard } from './src/onboard.js'
import { inquire, createDirectPending, listPending, consumePending, archiveTask, type PendingTask } from './src/inquire.js'
import { negotiate, implement, reviewAll, holisticReview } from './src/phases.js'
import { dim, bold, green, yellow, red } from './src/ui.js'

function usage(): void {
  console.error('  Usage:')
  console.error('    harness onboard                       Configure harness for this project')
  console.error('    harness "<task>"                       Start new task (discover + execute)')
  console.error('    harness discover "<task>"              Only run inquiry phase (produces pending)')
  console.error('    harness execute [task-id]              Run autonomous execution (latest or specified pending)')
  console.error('    harness execute --direct "<task>"      Skip inquiry, run task directly')
  console.error('    harness                                Resume interrupted task or list pending inquiries')
}

async function bootstrapEnv(): Promise<boolean> {
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000'
  if (config.customModel) {
    const ok = await startLiteLLM(config.customModel, config.model)
    if (!ok) {
      console.error(red('  Cannot start without LiteLLM. Run `harness onboard` to reconfigure.'))
      return false
    }
  }
  mkdirSync(PROGRESS_DIR, { recursive: true })
  return true
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const firstArg = args[0]?.trim()

  if (firstArg === 'onboard') {
    await onboard()
    return
  }

  if (!(await bootstrapEnv())) process.exit(1)

  if (firstArg === 'discover') {
    const task = args.slice(1).join(' ').trim()
    if (!task) { usage(); process.exit(1) }
    await inquire(task)
    return
  }

  if (firstArg === 'execute') {
    if (args[1] === '--direct') {
      const task = args.slice(2).join(' ').trim()
      if (!task) { usage(); process.exit(1) }
      const pending = createDirectPending(task)
      await runExecution(pending)
      return
    }
    const taskId = args[1]?.trim()
    const pending = consumePending(taskId)
    if (!pending) {
      console.error(red('  No pending task found. Run `harness discover "<task>"` first.'))
      process.exit(1)
      return
    }
    await runExecution(pending)
    return
  }

  const existingSprint = currentSprintNumber()

  if (existingSprint > 0) {
    // 断点恢复：已有 in-progress sprint
    await resumeExecution(existingSprint)
    return
  }

  if (!firstArg) {
    // 无参：列 pending
    const pendings = listPending()
    if (pendings.length > 0) {
      console.log(bold('\n  Pending inquiries:'))
      for (const p of pendings) {
        console.log(`    ${dim('·')} ${p.taskId}: ${p.originalTask.slice(0, 60)}`)
      }
      console.log(dim(`\n  Run 'harness execute' to run the latest.`))
      console.log(dim(`  Run 'harness execute <task-id>' to run a specific one.\n`))
      return
    }
    usage()
    process.exit(1)
  }

  // harness "<task>" 语法糖：discover + execute
  const task = args.join(' ').trim()
  const pending = await inquire(task)
  await runExecution(pending)
}

async function runExecution(pending: PendingTask): Promise<void> {
  console.log(dim('\n  ─── Harness: Generator ↔ Evaluator ───\n'))

  const inquiryPath = pending.inquiryDir || undefined

  let startSprint = 1
  let previousReview: string | undefined

  for (let sprintNum = startSprint; sprintNum <= startSprint + config.maxSprints; sprintNum++) {
    console.log(bold(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━`))
    console.log(bold(`       Sprint ${sprintNum}`))
    console.log(bold(`  ━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

    await negotiate(sprintNum, previousReview, inquiryPath)
    updateSprintState(sprintNum, 'implement')

    await implement(sprintNum)
    updateSprintState(sprintNum, 'review')

    const { review, collectedReview } = await reviewAll(sprintNum)

    if (!review) {
      console.log(yellow('    Review parse failed, re-running review...'))
      continue
    }

    if (review.approved) {
      updateSprintState(sprintNum, 'done')

      const holistic = await holisticReview(inquiryPath)

      if (holistic.pass) {
        let totalFeatures = 0
        for (let s = 1; s <= sprintNum; s++) {
          if (existsSync(sprintPath(s))) totalFeatures += loadSprint(s).features.length
        }
        console.log(green(bold(`\n  ✓ ALL APPROVED + HOLISTIC PASS — ${totalFeatures} features across ${sprintNum} sprint(s)\n`)))
        archiveTask(pending.taskId, pending)
        console.log(dim(`  Archived to .harness/completed/${pending.taskId}/\n`))
        return
      }

      previousReview = `# Holistic Review Failed\n\n${holistic.feedback}`
      console.log(yellow(`\n  Holistic review found issues → Sprint ${sprintNum + 1}\n`))
      continue
    }

    previousReview = collectedReview
    updateSprintState(sprintNum, 'done', previousReview)

    const disputeCount = (review.reviews ?? []).filter((r) => r.status === 'needs-revision').length
    console.log(yellow(`\n  ${disputeCount} features under dispute → Sprint ${sprintNum + 1}\n`))
  }

  console.log(yellow(`\n  Reached max sprints (${config.maxSprints}) without convergence.`))
  console.log(dim(`  Task left in progress. Inspect .harness/progress/ and continue manually if needed.\n`))
}

async function resumeExecution(existingSprint: number): Promise<void> {
  console.log(dim('\n  ─── Harness: Generator ↔ Evaluator (resume) ───\n'))

  const lastSprint = loadSprint(existingSprint)
  const inquiryPath = lastSprint.inquiryPath || undefined
  let startSprint = existingSprint
  let previousReview: string | undefined = lastSprint.previousReview

  if (lastSprint.phase === 'done') {
    startSprint = existingSprint + 1
  } else {
    console.log(dim(`  Resuming sprint ${existingSprint} (phase: ${lastSprint.phase})\n`))
  }

  for (let sprintNum = startSprint; sprintNum <= startSprint + config.maxSprints; sprintNum++) {
    console.log(bold(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━`))
    console.log(bold(`       Sprint ${sprintNum}`))
    console.log(bold(`  ━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

    const resumePhase = (sprintNum === startSprint && existsSync(sprintPath(sprintNum)))
      ? loadSprint(sprintNum).phase
      : null

    if (!resumePhase || resumePhase === 'negotiate') {
      await negotiate(sprintNum, previousReview, inquiryPath)
      updateSprintState(sprintNum, 'implement')
    }

    if (!resumePhase || resumePhase === 'negotiate' || resumePhase === 'implement') {
      await implement(sprintNum)
      updateSprintState(sprintNum, 'review')
    }

    const { review, collectedReview } = await reviewAll(sprintNum)

    if (!review) {
      console.log(yellow('    Review parse failed, re-running review...'))
      continue
    }

    if (review.approved) {
      updateSprintState(sprintNum, 'done')

      const holistic = await holisticReview(inquiryPath)

      if (holistic.pass) {
        let totalFeatures = 0
        for (let s = 1; s <= sprintNum; s++) {
          if (existsSync(sprintPath(s))) totalFeatures += loadSprint(s).features.length
        }
        console.log(green(bold(`\n  ✓ ALL APPROVED + HOLISTIC PASS — ${totalFeatures} features across ${sprintNum} sprint(s)\n`)))
        return
      }

      previousReview = `# Holistic Review Failed\n\n${holistic.feedback}`
      console.log(yellow(`\n  Holistic review found issues → Sprint ${sprintNum + 1}\n`))
      continue
    }

    previousReview = collectedReview
    updateSprintState(sprintNum, 'done', previousReview)

    const disputeCount = (review.reviews ?? []).filter((r) => r.status === 'needs-revision').length
    console.log(yellow(`\n  ${disputeCount} features under dispute → Sprint ${sprintNum + 1}\n`))
  }

  console.log(yellow(`\n  Reached max sprints (${config.maxSprints}) without convergence.\n`))
}

main().catch((e) => { console.error(red('  Error:'), e); process.exit(1) })
