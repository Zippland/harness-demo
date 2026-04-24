/**
 * Harness — Generator ↔ Evaluator 对抗架构
 *
 * 两阶段：
 *   harness discover "<task>"   — live: 和 Interrogator 对话，产出 pending task
 *   harness execute [task-id]   — autonomous: 选一个 task，跑 sprint 大循环
 *
 * Sprint 大循环：negotiate → implement(L1) → review(N+M) → holistic
 *
 *   harness "<task>"           — 语法糖：discover 然后 execute
 *   harness execute --direct "<task>"   — 熟练用户：跳过 discovery
 *   harness                    — 断点恢复 in-progress task 或列 pending
 *   harness onboard            — 交互式配置
 *
 * 每个 task 完整隔离在 .harness/tasks/<task-id>/ 下。
 */

import { existsSync, mkdirSync, readFileSync } from 'fs'
import { config, TASKS_DIR } from './src/config.js'
import { loadSprint, currentSprintNumber, updateSprintState } from './src/sprint.js'
import { startLiteLLM } from './src/litellm.js'
import { onboard } from './src/onboard.js'
import { inquire, createDirectTask, createHeadlessTask, listPendingTasks, pickTaskToExecute, taskStatus, type Task } from './src/inquire.js'
import { negotiate, implement, reviewAll, holisticReview } from './src/phases.js'
import { dim, bold, green, yellow, red } from './src/ui.js'
import { emit, isApiMode } from './src/event.js'

function usage(): void {
  console.error('  Usage:')
  console.error('    harness onboard                       Configure harness for this project')
  console.error('    harness "<task>"                       Start new task (discover + execute)')
  console.error('    harness discover "<task>"              Only run inquiry phase (produces pending task)')
  console.error('    harness execute [task-id]              Run autonomous execution (resumes in-progress, else newest pending)')
  console.error('    harness execute --direct "<task>"      Skip inquiry, run task directly')
  console.error('    harness                                Resume in-progress task or list pending tasks')
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
  mkdirSync(TASKS_DIR, { recursive: true })
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
    const taskText = args.slice(1).join(' ').trim()
    if (!taskText) { usage(); process.exit(1) }
    await inquire(taskText)
    return
  }

  if (firstArg === 'execute') {
    if (args[1] === '--direct') {
      const taskText = args.slice(2).join(' ').trim()
      if (!taskText) { usage(); process.exit(1) }
      const task = createDirectTask(taskText)
      await runExecution(task)
      return
    }
    const taskId = args[1]?.trim()
    const task = pickTaskToExecute(taskId)
    if (!task) {
      console.error(red('  No pending or in-progress task found. Run `harness discover "<task>"` first.'))
      process.exit(1)
      return
    }
    await runExecution(task)
    return
  }

  // 无参数：优先 resume in-progress；否则列 pending
  if (!firstArg) {
    const inProgress = pickTaskToExecute()
    if (inProgress && taskStatus(inProgress.taskId) === 'in-progress') {
      console.log(dim(`  Resuming in-progress task: ${inProgress.taskId}`))
      await runExecution(inProgress)
      return
    }
    const pendings = listPendingTasks()
    if (pendings.length > 0) {
      console.log(bold('\n  Pending tasks:'))
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
  // HARNESS_INQUIRY_MODE 决定走哪条创建路径（默认 interactive，由 inquire() 处理 CLI/API 输入源）
  const taskText = args.join(' ').trim()
  const inquiryMode = (process.env.HARNESS_INQUIRY_MODE ?? 'interactive') as 'interactive' | 'skip' | 'headless'

  let task: Task
  if (inquiryMode === 'skip') {
    task = createDirectTask(taskText)
  } else if (inquiryMode === 'headless') {
    const specPath = process.env.HARNESS_HEADLESS_SPEC_PATH
    if (!specPath || !existsSync(specPath)) {
      console.error(red(`  HARNESS_INQUIRY_MODE=headless requires HARNESS_HEADLESS_SPEC_PATH pointing to an existing spec draft file.`))
      process.exit(1)
    }
    const specContent = readFileSync(specPath, 'utf-8')
    task = createHeadlessTask(taskText, specContent)
  } else {
    task = await inquire(taskText)
  }
  await runExecution(task)
}

/**
 * 执行一个 task 的 sprint 大循环。task 可能是全新的（无 sprint 文件）或 in-progress
 * （已有 sprint 文件，断点恢复）。
 */
async function runExecution(task: Task): Promise<void> {
  console.log(dim('\n  ─── Harness: Generator ↔ Evaluator ───\n'))
  console.log(dim(`  Task: ${task.taskId}`))

  const taskId = task.taskId
  const existingSprint = currentSprintNumber(taskId)
  const isResume = existingSprint > 0

  let startSprint = 1
  let previousReview: string | undefined
  let resumePhase: import('./src/types.js').Sprint['phase'] | null = null

  if (isResume) {
    const lastSprint = loadSprint(taskId, existingSprint)
    previousReview = lastSprint.previousReview
    if (lastSprint.phase === 'done') {
      startSprint = existingSprint + 1
    } else {
      startSprint = existingSprint
      resumePhase = lastSprint.phase
      console.log(dim(`  Resuming sprint ${existingSprint} (phase: ${lastSprint.phase})\n`))
    }
  }

  emit('task.start', { taskId, isResume, startSprint, resumePhase })

  for (let sprintNum = startSprint; sprintNum <= startSprint + config.maxSprints; sprintNum++) {
    emit('sprint.start', { taskId, sprintNum })
    console.log(bold(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━`))
    console.log(bold(`       Sprint ${sprintNum}`))
    console.log(bold(`  ━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

    const phaseAtStart = (sprintNum === startSprint) ? resumePhase : null

    if (!phaseAtStart || phaseAtStart === 'negotiate') {
      await negotiate(taskId, sprintNum, previousReview)
      updateSprintState(taskId, sprintNum, 'implement')
    }

    if (!phaseAtStart || phaseAtStart === 'negotiate' || phaseAtStart === 'implement') {
      await implement(taskId, sprintNum)
      updateSprintState(taskId, sprintNum, 'review')
    }

    const { review, collectedReview } = await reviewAll(taskId, sprintNum)

    if (!review) {
      console.log(yellow('    Review parse failed, re-running review...'))
      continue
    }

    if (review.approved) {
      updateSprintState(taskId, sprintNum, 'done')

      const holistic = await holisticReview(taskId)

      if (holistic.pass) {
        let totalFeatures = 0
        for (let s = 1; s <= sprintNum; s++) {
          const sprintFile = loadSprintSafe(taskId, s)
          if (sprintFile) totalFeatures += sprintFile.features.length
        }
        console.log(green(bold(`\n  ✓ ALL APPROVED + HOLISTIC PASS — ${totalFeatures} features across ${sprintNum} sprint(s)\n`)))
        console.log(dim(`  Task complete. Files preserved at .harness/tasks/${taskId}/\n`))
        emit('task.done', { taskId, result: 'success', sprintCount: sprintNum, totalFeatures })
        return
      }

      previousReview = `# Holistic Review Failed\n\n${holistic.feedback}`
      console.log(yellow(`\n  Holistic review found issues → Sprint ${sprintNum + 1}\n`))
      continue
    }

    previousReview = collectedReview
    updateSprintState(taskId, sprintNum, 'done', previousReview)

    const featureDisputes = (review.reviews ?? []).filter((r) => r.status === 'needs-revision').length
    const dimensionDisputes = (review.dimensionReviews ?? []).filter((r) => r.status === 'needs-revision').length
    console.log(yellow(`\n  ${featureDisputes} feature(s) + ${dimensionDisputes} dimension(s) under dispute → Sprint ${sprintNum + 1}\n`))
  }

  console.log(yellow(`\n  Reached max sprints (${config.maxSprints}) without convergence.`))
  console.log(dim(`  Task left in progress at .harness/tasks/${taskId}/\n`))
  emit('task.done', { taskId, result: 'max_sprints', sprintCount: config.maxSprints })
}

function loadSprintSafe(taskId: string, n: number) {
  try { return loadSprint(taskId, n) } catch { return null }
}

main().catch((e) => { console.error(red('  Error:'), e); process.exit(1) })
