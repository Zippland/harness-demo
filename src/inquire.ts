import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, createWriteStream, type WriteStream } from 'fs'
import { resolve } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { config, WORK_DIR, TASKS_DIR, taskDir, inquiryDirFor, progressDirFor, PROMPTS_DIR } from './config.js'
import { bold, dim, green, cyan, startSpinner } from './ui.js'

export interface Task {
  taskId: string
  originalTask: string
  inquiryDir: string                    // .harness/tasks/<task-id>/inquiry/
  specPath: string                      // .../inquiry/spec.md
  sessionPath: string                   // .../inquiry/session.jsonl
  progressDir: string                   // .harness/tasks/<task-id>/progress/
  createdAt: string
  // 跨 sprint 的 SDK session IDs。task 是会话生命周期的边界，所有 sprint 共享同一组
  // session —— Generator 在不同 sprint 间继承上下文（已经做过什么、踩过什么坑）。
  // SDK auto-compact 负责管理上下文滚动。
  implementSessionId?: string
  negotiateGeneratorSessionId?: string
  negotiateEvaluatorSessionId?: string
}

// Interrogator 只负责"反问"，不再产 spec —— spec 由后续 negotiate 阶段对抗生成。
// 用户用 /done 主动结束讨论。
const TURN_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'What you want to say to the user this turn. Keep it natural — this is a conversation.',
      },
    },
    required: ['message'],
  },
}

function writeEvent(log: WriteStream, event: Record<string, any>): void {
  log.write(JSON.stringify({ ts: Date.now(), ...event }) + '\n')
}

/**
 * 直调 SDK 的 query()，遍历 message stream 时**聚合**成单条对话事件写入 session.jsonl。
 * 不转储 SDK raw stream（init/result/modelUsage/cost 全丢）。
 * user 事件由 inquire() 负责写，此函数只写 assistant 事件。
 */
async function runInterrogatorTurn(
  prompt: string,
  sessionId: string | undefined,
  sessionLog: WriteStream,
): Promise<{ sessionId: string; text: string; structured?: any }> {
  const q = query({
    prompt,
    options: {
      cwd: WORK_DIR,
      permissionMode: 'acceptEdits' as const,
      model: config.model,
      // Interrogator 故意不挂 mcpServers — 纯对话阶段，浏览器与"不主动探索"的设计冲突。
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Write', 'Edit', 'Bash', 'TodoWrite', 'TodoRead'],
      ...(sessionId ? { resume: sessionId } : {}),
      outputFormat: TURN_SCHEMA,
    },
  })

  let newSessionId = sessionId || ''
  let text = ''
  let structured: any
  const toolCalls: Array<{ name: string; input: any }> = []

  try {
    for await (const msg of q) {
      if ('session_id' in msg && (msg as any).session_id) {
        newSessionId = (msg as any).session_id
      }
      if (msg.type === 'assistant') {
        for (const block of ((msg as any).message?.content ?? [])) {
          if (block.type === 'text' && block.text?.trim()) {
            text += block.text
          }
          if (block.type === 'tool_use') {
            toolCalls.push({ name: block.name, input: block.input })
          }
        }
      }
      if (msg.type === 'result' && (msg as any).subtype === 'success') {
        structured = (msg as any).structured_output
      }
    }
  } catch (e: any) {
    const errMsg = String(e?.message ?? e)
    writeEvent(sessionLog, { role: 'system', kind: 'error', content: errMsg })
    throw e
  }

  const finalText = (structured?.message ?? text).trim()
  const event: Record<string, any> = { role: 'assistant', content: finalText }
  if (toolCalls.length > 0) event.tool_calls = toolCalls
  writeEvent(sessionLog, event)

  return { sessionId: newSessionId, text: finalText, structured }
}

function newTask(originalTask: string): Task {
  const ts = Date.now()
  const taskId = `task-${ts}`
  const inquiryDir = inquiryDirFor(taskId)
  const progressDir = progressDirFor(taskId)
  mkdirSync(inquiryDir, { recursive: true })
  mkdirSync(progressDir, { recursive: true })
  return {
    taskId,
    originalTask,
    inquiryDir,
    specPath: resolve(inquiryDir, 'spec.md'),
    sessionPath: resolve(inquiryDir, 'session.jsonl'),
    progressDir,
    createdAt: new Date().toISOString(),
  }
}

/**
 * task.json：写入 task 元数据 + 跨 sprint 的 session IDs。
 * 生命周期状态（pending/in-progress/completed）仍由文件结构隐含（见 taskStatus()），
 * 不写在这里。session IDs 写这里，而不是 sprint 文件，是为了让所有 sprint 共享同一组 session。
 */
export function saveTask(task: Task): void {
  writeFileSync(resolve(taskDir(task.taskId), 'task.json'), JSON.stringify(task, null, 2))
}

export async function inquire(originalTask: string): Promise<Task> {
  mkdirSync(TASKS_DIR, { recursive: true })
  const task = newTask(originalTask)

  const sessionLog = createWriteStream(task.sessionPath, { flags: 'a' })

  // 首轮 setup：role 和 originalTask 分两条事件记录
  const roleText = readFileSync(resolve(PROMPTS_DIR, 'inquire/interrogator.md'), 'utf-8').trim()
  writeEvent(sessionLog, { role: 'system', content: roleText })
  writeEvent(sessionLog, { role: 'user', content: originalTask })

  const readline = await import('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  console.log(bold('\n  ══ INQUIRY ══\n'))
  console.log(dim(`  Task: ${task.taskId}`))
  console.log(dim('  Talk with the Interrogator to surface what this task really is.'))
  console.log(dim('  Interrogator only asks — never writes the spec.'))
  console.log(dim('  Type /done when you feel enough has been surfaced.\n'))

  // 首轮 SDK prompt = role 描述 + 原始 task，在代码里拼接
  const firstPrompt = `${roleText}\n\n${originalTask}`
  let userMessage = firstPrompt
  let sessionId: string | undefined

  while (true) {
    console.log(`\n  ${dim('──')} ${cyan('Interrogator')} ${dim('──')}`)
    const stopSpinner = startSpinner('thinking...')
    let newId: string
    let text: string
    let structured: any
    try {
      const turn = await runInterrogatorTurn(userMessage, sessionId, sessionLog)
      newId = turn.sessionId
      text = turn.text
      structured = turn.structured
    } finally {
      stopSpinner()
    }
    sessionId = newId
    const display = (structured?.message ?? text).trim()
    for (const line of display.split('\n')) console.log(`    ${cyan('>')} ${line}`)

    const reply = (await ask('\n  You (or /done): ')).trim()
    if (reply.toLowerCase() === '/done') {
      console.log(dim('  Discussion closed by user.'))
      break
    }
    writeEvent(sessionLog, { role: 'user', content: reply })
    userMessage = reply
  }
  rl.close()

  // spec.md 留作空占位文件，由后续 negotiate 阶段的 Generator 填入。
  // 控制论意义：spec 由对抗驱动产生（negotiate Gen↔Eval），而非 Interrogator 单边压缩。
  writeFileSync(task.specPath, '')
  sessionLog.end()
  saveTask(task)

  console.log(green(`\n  ✓ Inquiry saved: ${taskDir(task.taskId)}`))
  console.log(dim(`    session: ${task.sessionPath}`))
  console.log(dim(`    spec:    ${task.specPath} (empty placeholder — Generator/Evaluator will fill it during negotiate)`))
  console.log(dim(`  Run 'harness execute' to start autonomous execution.\n`))
  return task
}

export function createDirectTask(originalTask: string): Task {
  mkdirSync(TASKS_DIR, { recursive: true })
  const task = newTask(originalTask)

  // spec.md 留空，由 negotiate 阶段填入。direct mode 把原始 task 写进 session 让 Generator 看到。
  writeFileSync(task.specPath, '')

  const ts = Date.now()
  const sessionSeed = JSON.stringify({
    ts, role: 'user', content: originalTask,
  }) + '\n' + JSON.stringify({
    ts, role: 'system',
    content: 'Direct mode — no interactive inquiry. The user message above is the task verbatim. Generator should treat it as the seed for spec.md.',
  }) + '\n'
  writeFileSync(task.sessionPath, sessionSeed)
  saveTask(task)

  return task
}

/**
 * 推断 task 当前生命周期状态。基于文件结构判断，无 status 字段：
 * - completed: 最新 sprint 的 phase === 'done'
 * - in-progress: 有 sprint 文件但最新 phase !== 'done'
 * - pending: 没 sprint 文件
 */
export function taskStatus(taskId: string): 'pending' | 'in-progress' | 'completed' {
  const progressDir = progressDirFor(taskId)
  if (!existsSync(progressDir)) return 'pending'
  const files = readdirSync(progressDir).filter((f) => /^sprint-\d+\.json$/.test(f))
  if (files.length === 0) return 'pending'
  const latest = Math.max(...files.map((f) => parseInt(f.match(/\d+/)![0])))
  try {
    const sprint = JSON.parse(readFileSync(resolve(progressDir, `sprint-${latest}.json`), 'utf-8'))
    return sprint.phase === 'done' ? 'completed' : 'in-progress'
  } catch {
    return 'in-progress'
  }
}

export function loadTask(taskId: string): Task | null {
  const metaPath = resolve(taskDir(taskId), 'task.json')
  if (!existsSync(metaPath)) return null
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as Task
  } catch {
    return null
  }
}

export function listTasks(): Task[] {
  if (!existsSync(TASKS_DIR)) return []
  return readdirSync(TASKS_DIR)
    .filter((d) => d.startsWith('task-'))
    .map((d) => loadTask(d))
    .filter((t): t is Task => t !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function listPendingTasks(): Task[] {
  return listTasks().filter((t) => taskStatus(t.taskId) === 'pending')
}

/**
 * 选一个 task 执行。指定 taskId 就找它；不指定则优先选 in-progress（断点恢复），
 * 没有再选最新 pending。
 */
export function pickTaskToExecute(taskId?: string): Task | null {
  const all = listTasks()
  if (taskId) return all.find((t) => t.taskId === taskId) ?? null
  const inProgress = all.find((t) => taskStatus(t.taskId) === 'in-progress')
  if (inProgress) return inProgress
  return all.find((t) => taskStatus(t.taskId) === 'pending') ?? null
}

export function buildInquiryReference(specPath?: string, sessionPath?: string): string {
  if (!specPath || !existsSync(specPath)) {
    return '<TASK_SPEC>\nNo inquiry was performed for this task. No authoritative spec is available.\n</TASK_SPEC>'
  }
  const spec = readFileSync(specPath, 'utf-8').trim()

  const lines = [
    '<TASK_SPEC>',
    '',
    spec,
    '',
    '</TASK_SPEC>',
    '',
    'The `<TASK_SPEC>` above is this task\'s **source of truth** — a living product document.',
    `Edit it directly (\`${specPath}\`) as your understanding deepens; don't silently deviate.`,
    'This overrides any role-prompt rule about "only modifying files under `project/`".',
  ]

  if (sessionPath) {
    lines.push(
      '',
      '<INQUIRY_SESSION>',
      '',
      `Full discovery transcript (jsonl; each line is \`{role, content, ...}\`, role ∈ {system, user, assistant}):`,
      sessionPath,
      '',
      'Immutable record of what was actually said. Read it when the spec doesn\'t answer your question.',
      'On spec-vs-session conflict, the session wins.',
      '',
      '</INQUIRY_SESSION>',
    )
  }

  return lines.join('\n')
}

export function referenceFromInquiryDir(inquiryDir?: string): string {
  if (!inquiryDir) return buildInquiryReference()
  return buildInquiryReference(
    resolve(inquiryDir, 'spec.md'),
    resolve(inquiryDir, 'session.jsonl'),
  )
}

// Pointer-only 形态：返回 spec / session 文件路径，不组装文本。
// prompt 模板（generator-system.md）自己写说明文字，这里只提供数据。
export function inquiryPaths(inquiryDir?: string): { specPath: string; sessionPath: string } {
  if (!inquiryDir) return { specPath: '(none — no inquiry was performed)', sessionPath: '(none)' }
  return {
    specPath: resolve(inquiryDir, 'spec.md'),
    sessionPath: resolve(inquiryDir, 'session.jsonl'),
  }
}
