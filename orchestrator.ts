/**
 * Harness — Generator ↔ Evaluator 对抗架构
 *
 * Sprint 大循环：negotiate → implement(L1) → review(N+M) → holistic
 *
 * harness onboard     — 交互式配置
 * harness "<task>"    — 启动新任务
 * harness             — 断点恢复
 */

import { existsSync, mkdirSync } from 'fs'
import { config, PROGRESS_DIR } from './src/config.js'
import { sprintPath, loadSprint, currentSprintNumber, updateSprintState } from './src/sprint.js'
import { startLiteLLM } from './src/litellm.js'
import { onboard } from './src/onboard.js'
import { negotiate, implement, reviewAll, holisticReview } from './src/phases.js'
import { dim, bold, green, yellow, red } from './src/ui.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const firstArg = args[0]?.trim()

  if (firstArg === 'onboard') {
    await onboard()
    return
  }

  const task = args.join(' ').trim()

  // 提高输出 token 上限
  process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000'

  // 如果配置了自定义模型，自动启动 LiteLLM 代理
  if (config.customModel) {
    const ok = await startLiteLLM(config.customModel, config.model)
    if (!ok) {
      console.error(red('  Cannot start without LiteLLM. Run `harness onboard` to reconfigure.'))
      process.exit(1)
    }
  }

  mkdirSync(PROGRESS_DIR, { recursive: true })

  const existingSprint = currentSprintNumber()

  if (!task && existingSprint === 0) {
    console.error('  Usage:')
    console.error('    harness onboard           Configure harness for this project')
    console.error('    harness "<task>"           Start a new task')
    console.error('    harness                    Resume interrupted task')
    process.exit(1)
  }

  console.log(dim('\n  ─── Harness: Generator ↔ Evaluator ───\n'))

  // 断点恢复
  let startSprint = existingSprint + 1
  let previousReview: string | undefined

  if (existingSprint > 0) {
    const lastSprint = loadSprint(existingSprint)
    if (lastSprint.phase !== 'done') {
      startSprint = existingSprint
      previousReview = lastSprint.previousReview
      if (!task && lastSprint.task) {
        console.log(dim(`  Resuming sprint ${existingSprint} (phase: ${lastSprint.phase})\n`))
      }
    } else {
      previousReview = lastSprint.previousReview
    }
  }

  const resolvedTask = task || (existingSprint > 0 ? loadSprint(existingSprint).task : '')

  // Sprint 大循环
  for (let sprintNum = startSprint; sprintNum <= startSprint + config.maxSprints; sprintNum++) {
    console.log(bold(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━`))
    console.log(bold(`       Sprint ${sprintNum}`))
    console.log(bold(`  ━━━━━━━━━━━━━━━━━━━━━━━━━\n`))

    const resumePhase = (sprintNum === startSprint && existingSprint > 0 && existsSync(sprintPath(sprintNum)))
      ? loadSprint(sprintNum).phase
      : null

    // Phase 0: 协商
    if (!resumePhase || resumePhase === 'negotiate') {
      await negotiate(resolvedTask, sprintNum, previousReview)
      updateSprintState(sprintNum, 'implement')
    }

    // Phase 1: 实现 + L1
    if (!resumePhase || resumePhase === 'negotiate' || resumePhase === 'implement') {
      await implement(sprintNum)
      updateSprintState(sprintNum, 'review')
    }

    // Phase 2: N+M 并行 review
    const { review, collectedReview } = await reviewAll(resolvedTask, sprintNum)

    if (!review) {
      console.log(yellow('    Review parse failed, re-running review...'))
      continue
    }

    if (review.approved) {
      updateSprintState(sprintNum, 'done')

      // Phase 3: Holistic review
      const holistic = await holisticReview(resolvedTask)

      if (holistic.pass) {
        let totalFeatures = 0
        for (let s = 1; s <= sprintNum; s++) {
          if (existsSync(sprintPath(s))) totalFeatures += loadSprint(s).features.length
        }
        console.log(green(bold(`\n  ✓ ALL APPROVED + HOLISTIC PASS — ${totalFeatures} features across ${sprintNum} sprint(s)\n`)))
        break
      }

      previousReview = `# Holistic Review Failed\n\n${holistic.feedback}`
      console.log(yellow(`\n  Holistic review found issues → Sprint ${sprintNum + 1}\n`))
      continue
    }

    // 有分歧
    previousReview = collectedReview
    updateSprintState(sprintNum, 'done', previousReview)

    const disputeCount = (review.reviews ?? []).filter((r) => r.status === 'needs-revision').length
    console.log(yellow(`\n  ${disputeCount} features under dispute → Sprint ${sprintNum + 1}\n`))
  }
}

main().catch((e) => { console.error(red('  Error:'), e); process.exit(1) })
