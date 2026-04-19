import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, createWriteStream, type WriteStream } from 'fs'
import { resolve } from 'path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { config, WORK_DIR, INQUIRY_DIR, PENDING_DIR, COMPLETED_DIR, PROGRESS_DIR } from './config.js'
import { loadPrompt } from './agent.js'
import { bold, dim, green, cyan, yellow, red } from './ui.js'

export interface PendingTask {
  taskId: string
  originalTask: string
  inquiryDir: string
  specPath: string
  sessionPath: string
  createdAt: string
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

async function runInterrogatorTurn(
  userMessage: string,
  sessionId: string | undefined,
  outputFormat: any | undefined,
  sessionLog: WriteStream,
): Promise<{ sessionId: string; text: string; structured?: any }> {
  sessionLog.write(JSON.stringify({ ts: Date.now(), _from: 'user', prompt: userMessage }) + '\n')

  const q = query({
    prompt: userMessage,
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

  try {
    for await (const msg of q) {
      sessionLog.write(JSON.stringify({ ts: Date.now(), _from: 'sdk', ...msg }) + '\n')

      if ('session_id' in msg && (msg as any).session_id) {
        newSessionId = (msg as any).session_id
      }
      if (msg.type === 'assistant') {
        for (const block of ((msg as any).message?.content ?? [])) {
          if (block.type === 'text' && block.text?.trim()) {
            text += block.text
          }
        }
      }
      if (msg.type === 'result' && (msg as any).subtype === 'success') {
        structured = (msg as any).structured_output
      }
    }
  } catch (e: any) {
    const errMsg = String(e?.message ?? e)
    sessionLog.write(JSON.stringify({ ts: Date.now(), _from: 'error', message: errMsg }) + '\n')
    throw e
  }

  return { sessionId: newSessionId, text: text.trim(), structured }
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

  const readline = await import('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  console.log(bold('\n  ══ INQUIRY ══\n'))
  console.log(dim('  Discuss with the Interrogator to clarify what this task really means.'))
  console.log(dim('  Type "done" when you are ready to begin execution.\n'))

  // 首轮：注入角色定义 + 原始任务
  const firstPrompt = loadPrompt('inquire/interrogator', { originalTask })
  let userMessage = firstPrompt
  let sessionId: string | undefined

  while (true) {
    console.log(`\n  ${dim('──')} ${cyan('Interrogator')} ${dim('──')}`)
    const { sessionId: newId, text } = await runInterrogatorTurn(userMessage, sessionId, undefined, sessionLog)
    sessionId = newId
    for (const line of text.split('\n')) console.log(`    ${cyan('>')} ${line}`)

    const reply = (await ask('\n  You (or "done"): ')).trim()
    if (reply.toLowerCase() === 'done') break
    userMessage = reply
  }
  rl.close()

  // 收敛后：让 Interrogator 产出 spec
  console.log(dim('\n  Drafting task spec...'))
  let spec = ''
  try {
    const { structured } = await runInterrogatorTurn(SPEC_PROMPT, sessionId, SPEC_SCHEMA, sessionLog)
    spec = structured?.spec ?? ''
  } catch (e: any) {
    console.log(red(`    Spec draft failed: ${e?.message ?? e}`))
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
    return '<TASK_SPEC>\nNo inquiry was performed for this task. Proceed with the original task description only.\n</TASK_SPEC>'
  }
  const spec = readFileSync(specPath, 'utf-8').trim()
  const sessionLine = sessionPath
    ? `\n\n<INQUIRY_SESSION>\nThe full, unabridged discussion is at: ${sessionPath}\n\nRead this file ONLY when the spec above fails to disambiguate. It contains every turn of the conversation including directions the user explicitly rejected.\n</INQUIRY_SESSION>`
    : ''
  return `<TASK_SPEC>\n\n${spec}\n\n</TASK_SPEC>${sessionLine}`
}

export function referenceFromInquiryDir(inquiryDir?: string): string {
  if (!inquiryDir) return buildInquiryReference()
  return buildInquiryReference(
    resolve(inquiryDir, 'spec.md'),
    resolve(inquiryDir, 'session.jsonl'),
  )
}
