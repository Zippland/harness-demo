import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, createWriteStream, type WriteStream } from 'fs'
import { resolve } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { config, WORK_DIR, INQUIRY_DIR, PENDING_DIR, COMPLETED_DIR, PROGRESS_DIR, PROMPTS_DIR } from './config.js'
import { bold, dim, green, cyan, startSpinner } from './ui.js'

export interface PendingTask {
  taskId: string
  originalTask: string
  inquiryDir: string
  specPath: string
  sessionPath: string
  createdAt: string
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

export async function inquire(originalTask: string): Promise<PendingTask> {
  mkdirSync(INQUIRY_DIR, { recursive: true })
  mkdirSync(PENDING_DIR, { recursive: true })

  const ts = Date.now()
  const taskId = `task-${ts}`
  const inquiryDir = resolve(INQUIRY_DIR, taskId)
  mkdirSync(inquiryDir, { recursive: true })
  const specPath = resolve(inquiryDir, 'spec.md')
  const sessionPath = resolve(inquiryDir, 'session.jsonl')
  const pendingPath = resolve(PENDING_DIR, `${taskId}.json`)

  const sessionLog = createWriteStream(sessionPath, { flags: 'a' })

  // 首轮 setup：role 和 originalTask 分两条事件记录
  const roleText = readFileSync(resolve(PROMPTS_DIR, 'inquire/interrogator.md'), 'utf-8').trim()
  writeEvent(sessionLog, { role: 'system', content: roleText })
  writeEvent(sessionLog, { role: 'user', content: originalTask })

  const readline = await import('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  console.log(bold('\n  ══ INQUIRY ══\n'))
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
  writeFileSync(specPath, '')
  sessionLog.end()

  const pending: PendingTask = {
    taskId,
    originalTask,
    inquiryDir,
    specPath,
    sessionPath,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2))

  console.log(green(`\n  ✓ Inquiry saved:`))
  console.log(dim(`    session: ${sessionPath}`))
  console.log(dim(`    spec:    ${specPath} (empty placeholder — Generator/Evaluator will fill it during negotiate)`))
  console.log(dim(`  Run 'harness execute' to start autonomous execution.\n`))
  return pending
}

export function createDirectPending(originalTask: string): PendingTask {
  mkdirSync(INQUIRY_DIR, { recursive: true })
  mkdirSync(PENDING_DIR, { recursive: true })
  const ts = Date.now()
  const taskId = `direct-${ts}`
  const inquiryDir = resolve(INQUIRY_DIR, taskId)
  mkdirSync(inquiryDir, { recursive: true })
  const specPath = resolve(inquiryDir, 'spec.md')
  const sessionPath = resolve(inquiryDir, 'session.jsonl')

  // spec.md 留空，由 negotiate 阶段填入。direct mode 把原始 task 写进 session 让 Generator 看到。
  writeFileSync(specPath, '')

  const sessionSeed = JSON.stringify({
    ts,
    role: 'user',
    content: originalTask,
  }) + '\n' + JSON.stringify({
    ts,
    role: 'system',
    content: 'Direct mode — no interactive inquiry. The user message above is the task verbatim. Generator should treat it as the seed for spec.md.',
  }) + '\n'
  writeFileSync(sessionPath, sessionSeed)

  const pending: PendingTask = {
    taskId,
    originalTask,
    inquiryDir,
    specPath,
    sessionPath,
    createdAt: new Date().toISOString(),
  }
  writeFileSync(resolve(PENDING_DIR, `${taskId}.json`), JSON.stringify(pending, null, 2))
  return pending
}

export function listPending(): PendingTask[] {
  if (!existsSync(PENDING_DIR)) return []
  return readdirSync(PENDING_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(PENDING_DIR, f), 'utf-8')) as PendingTask)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function consumePending(taskId?: string): PendingTask | null {
  const pendings = listPending()
  if (pendings.length === 0) return null
  if (!taskId) return pendings[0]
  return pendings.find((p) => p.taskId === taskId) ?? null
}

export function archiveTask(taskId: string, pending: PendingTask): void {
  mkdirSync(COMPLETED_DIR, { recursive: true })
  const archiveDir = resolve(COMPLETED_DIR, taskId)
  mkdirSync(archiveDir, { recursive: true })

  if (existsSync(pending.specPath)) {
    writeFileSync(resolve(archiveDir, 'spec.md'), readFileSync(pending.specPath, 'utf-8'))
  }
  if (existsSync(pending.sessionPath)) {
    writeFileSync(resolve(archiveDir, 'session.jsonl'), readFileSync(pending.sessionPath, 'utf-8'))
  }

  if (existsSync(PROGRESS_DIR)) {
    for (const f of readdirSync(PROGRESS_DIR)) {
      if (f.startsWith('sprint-') && f.endsWith('.json')) {
        const src = resolve(PROGRESS_DIR, f)
        writeFileSync(resolve(archiveDir, f), readFileSync(src, 'utf-8'))
        unlinkSync(src)
      }
    }
  }

  const pendingFile = resolve(PENDING_DIR, `${taskId}.json`)
  if (existsSync(pendingFile)) unlinkSync(pendingFile)
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

