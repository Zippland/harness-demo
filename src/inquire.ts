import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, createWriteStream, type WriteStream } from 'fs'
import { resolve } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { config, WORK_DIR, INQUIRY_DIR, PENDING_DIR, COMPLETED_DIR, PROGRESS_DIR, PROMPTS_DIR } from './config.js'
import { bold, dim, green, cyan, yellow, red, startSpinner } from './ui.js'

export interface PendingTask {
  taskId: string
  originalTask: string
  inquiryDir: string
  specPath: string
  sessionPath: string
  createdAt: string
}

const TURN_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'What you want to say to the user this turn.',
      },
      ready_for_spec: {
        type: 'boolean',
        description: 'Set true only when enough has surfaced to write a useful spec. The discussion will end immediately — use your judgment. Default false.',
      },
    },
    required: ['message', 'ready_for_spec'],
  },
}

const SPEC_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      spec: {
        type: 'string',
        description: 'A single markdown document capturing the task spec. Include: the user\'s true goal, what is in scope, what was explicitly ruled out during our discussion, and what success looks like. Write in markdown with sections as you see fit. Keep it tight — this is the *compressed* view; the full discussion is preserved separately.',
      },
    },
    required: ['spec'],
  },
}

const SPEC_PROMPT = `Our discussion is complete. Now write the task spec.

Output a single markdown document (via the structured JSON schema) that captures:

- **What the user truly wants** — the underlying goal, not just the surface request
- **What is in scope** — concrete boundaries
- **What was explicitly ruled out** — directions you and the user considered and rejected; this is the most important part because it prevents future drift
- **What success looks like** — observable signs the task is done right

Write in markdown. Organize with headings however is clearest. Do not pad.`

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
  outputFormat: any | undefined,
  sessionLog: WriteStream,
  kind?: 'spec',
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
      ...(outputFormat ? { outputFormat } : {}),
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

  const finalText = (structured?.message ?? structured?.spec ?? text).trim()
  const event: Record<string, any> = { role: 'assistant', content: finalText }
  if (toolCalls.length > 0) event.tool_calls = toolCalls
  if (kind) event.kind = kind
  if (structured?.ready_for_spec === true) event.ready_for_spec = true
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
  console.log(dim('  Talk with the Interrogator to figure out what this task really is.'))
  console.log(dim('  The Interrogator ends when it thinks enough has surfaced;'))
  console.log(dim('  type /done to force-end early.\n'))

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
      const turn = await runInterrogatorTurn(userMessage, sessionId, TURN_SCHEMA, sessionLog)
      newId = turn.sessionId
      text = turn.text
      structured = turn.structured
    } finally {
      stopSpinner()
    }
    sessionId = newId
    const display = (structured?.message ?? text).trim()
    for (const line of display.split('\n')) console.log(`    ${cyan('>')} ${line}`)

    if (structured?.ready_for_spec === true) {
      console.log(dim('\n  Interrogator indicated enough has surfaced.'))
      break
    }

    const reply = (await ask('\n  You (or /done): ')).trim()
    if (reply.toLowerCase() === '/done') {
      console.log(dim('  User force-ended the discussion.'))
      break
    }
    writeEvent(sessionLog, { role: 'user', content: reply })
    userMessage = reply
  }
  rl.close()

  // 收敛后：让 Interrogator 写 spec
  writeEvent(sessionLog, { role: 'system', kind: 'spec_request', content: SPEC_PROMPT })

  const stopSpecSpinner = startSpinner('drafting task spec...')
  let spec = ''
  try {
    const { structured } = await runInterrogatorTurn(SPEC_PROMPT, sessionId, SPEC_SCHEMA, sessionLog, 'spec')
    spec = structured?.spec ?? ''
  } catch (e: any) {
    console.log(red(`    Spec draft failed: ${e?.message ?? e}`))
  } finally {
    stopSpecSpinner()
  }

  if (!spec) {
    console.log(yellow('    ⚠ Interrogator did not produce a spec. Writing fallback.'))
    spec = `# Task Spec\n\n${originalTask}\n\n_(Interrogator did not produce a structured spec; see session.jsonl for full discussion.)_\n`
  }

  writeFileSync(specPath, spec)
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
  console.log(dim(`    spec:    ${specPath}`))
  console.log(dim(`    session: ${sessionPath}`))
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

  const specMd = [
    '# Task Spec (direct mode)',
    '',
    'No interactive inquiry was performed. The user invoked `harness execute --direct` with the following task, which should be treated as the authoritative spec:',
    '',
    originalTask,
    '',
  ].join('\n')
  writeFileSync(specPath, specMd)

  const sessionSeed = JSON.stringify({
    ts,
    role: 'system',
    content: 'Direct mode — no interactive inquiry was performed. The spec.md above contains the task verbatim as the user provided it.',
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

  const specNote = [
    '',
    'The `<TASK_SPEC>` above is this task\'s **source of truth** — authoritative and prescriptive.',
    'Any conceptual change (scope, non-goals, success criteria, intent) must be made by updating',
    'the spec first, then the code/contract. Do not silently deviate. If you believe the spec is',
    'wrong or incomplete, flag it explicitly in your response — do not work around it.',
  ].join('\n')

  const sessionBlock = sessionPath
    ? [
        '',
        '<INQUIRY_SESSION>',
        '',
        `The full, unabridged discovery discussion is at: ${sessionPath}`,
        '',
        'Unlike the spec (which is authoritative but revisable), the session is **immutable ground',
        'truth** — it records what was actually said during discovery and never changes. Read it',
        'only when the spec fails to disambiguate. It contains every turn of the conversation,',
        'including directions the user explicitly rejected.',
        '',
        '</INQUIRY_SESSION>',
      ].join('\n')
    : ''

  return `<TASK_SPEC>\n\n${spec}\n\n</TASK_SPEC>${specNote}${sessionBlock}`
}

export function referenceFromInquiryDir(inquiryDir?: string): string {
  if (!inquiryDir) return buildInquiryReference()
  return buildInquiryReference(
    resolve(inquiryDir, 'spec.md'),
    resolve(inquiryDir, 'session.jsonl'),
  )
}
