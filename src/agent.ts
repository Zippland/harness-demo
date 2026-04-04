import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config, WORK_DIR, TOOL_DIR, PROMPTS_DIR } from './config.js'
import { dim, cyan, yellow, red, ROLE_STYLE, logTool } from './ui.js'
import type { Role } from './types.js'

// ─── Agent 工具权限 ───

const AGENT_CONFIG: Record<Role, Record<string, any>> = {
  Generator: {
    model: config.model,
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'TodoRead'],
  },
  Evaluator: {
    model: config.model,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'TodoRead'],
    disallowedTools: ['Write', 'Edit', 'TodoWrite'],
  },
}

// ─── Prompt loader ───

export function loadPrompt(name: string, vars: Record<string, string>): string {
  const tmpl = readFileSync(resolve(PROMPTS_DIR, `${name}.md`), 'utf-8')
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`)
}

// ─── Agent Runner ───

export async function runAgent(
  role: Role,
  prompt: string,
  opts: { resume?: string; outputFormat?: any; toolOverrides?: Record<string, any>; silent?: boolean } = {},
): Promise<{ sessionId: string; result: string; structured?: any }> {
  if (!opts.silent) {
    const color = ROLE_STYLE[role]
    console.log(`\n  ${dim('──')} ${color(role)} ${dim('──')}`)
  }

  const q = query({
    prompt,
    options: {
      cwd: WORK_DIR,
      permissionMode: 'acceptEdits' as const,
      ...AGENT_CONFIG[role],
      ...(opts.toolOverrides ?? {}),
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
    },
  })

  let sessionId = ''
  let result = ''
  let structured: any
  const textBlocks: string[] = []

  try {
    for await (const msg of q) {
      if (msg.type === 'assistant') {
        for (const block of ((msg as any).message?.content ?? [])) {
          if (block.type === 'text' && block.text?.trim()) {
            const text = block.text.trim()
            textBlocks.push(text)
            for (const line of text.split('\n')) {
              console.log(`    ${cyan('>')} ${line}`)
            }
          }
          if (block.type === 'tool_use') {
            logTool(block.name, block.input)
          }
        }
      }
      if ('session_id' in msg && (msg as any).session_id) {
        sessionId = (msg as any).session_id
      }
      if (msg.type === 'result' && (msg as any).subtype === 'success') {
        result = (msg as any).result ?? ''
        structured = (msg as any).structured_output
      }
    }
  } catch (e: any) {
    const errMsg = String(e?.message ?? e)

    if (errMsg.includes('output token') && sessionId) {
      console.log(`    ${yellow('!')} ${dim('Output token limit hit, resuming...')}`)
      return runAgent(role, 'Continue where you left off. Complete your remaining work.', { ...opts, resume: sessionId })
    }

    if (errMsg.includes('rate limit') || errMsg.includes('overloaded') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT')) {
      console.log(`    ${yellow('!')} ${dim(`Transient error: ${errMsg.slice(0, 80)}. Retrying in 10s...`)}`)
      await new Promise((r) => setTimeout(r, 10_000))
      return runAgent(role, prompt, opts)
    }

    console.log(`    ${red('!')} ${dim(`Agent error: ${errMsg.slice(0, 100)}`)}`)
    return { sessionId, result: `[Agent error: ${errMsg}]`, structured: undefined }
  }

  const joined = textBlocks.join('\n\n') || result
  const fullResponse = joined.length > 5000 ? joined.slice(-5000) : joined

  return { sessionId, result: fullResponse, structured }
}

// ─── Research → Execute 两阶段 ───

export const RESEARCH_TOOLS = {
  allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'TodoWrite', 'TodoRead'],
  disallowedTools: ['Write', 'Edit'],
}

export const RESEARCH_COMPLETE_SCHEMA = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['research_complete'], description: 'Output this when you have finished your research and are ready to execute.' },
    },
    required: ['status'],
  },
}

/**
 * 两阶段模式：research → execute
 *
 * 消息序列：
 *   user msg 1: researchPrompt（含上下文 + 调研指令）
 *   → agent 调研（只有 Read 类工具）
 *   → agent 输出 { status: "research_complete" } 主动移交
 *   user msg 2: executePrompt（执行指令）
 *   → agent 执行（完整工具）
 */
export async function runWithResearch(
  role: Role,
  researchPrompt: string,
  executePrompt: string,
  opts: { outputFormat?: any } = {},
): Promise<{ sessionId: string; result: string; structured?: any }> {
  const researchPrinciples = readFileSync(resolve(TOOL_DIR, 'control/research-principles.md'), 'utf-8')

  const color = ROLE_STYLE[role]
  console.log(`\n  ${dim('──')} ${color(role)} ${dim('──')}`)
  console.log(dim('    [research mode]'))

  const research = await runAgent(role, `${researchPrompt}\n\n<RESEARCH_PRINCIPLES>\n\n${researchPrinciples}\n\n</RESEARCH_PRINCIPLES>`, {
    toolOverrides: RESEARCH_TOOLS,
    outputFormat: RESEARCH_COMPLETE_SCHEMA,
    silent: true,  // 不重复打印 agent 标签
  })

  // 同一 agent，切换模式
  console.log(dim('    [execute mode]'))
  return runAgent(role, executePrompt, {
    resume: research.sessionId,
    toolOverrides: {},
    silent: true,
    ...opts,
  })
}
