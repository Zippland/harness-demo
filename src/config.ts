import { readFileSync, existsSync } from 'fs'
import { resolve, relative } from 'path'
import type { HarnessConfig, McpServerSpec } from './types.js'
import { loadSquad } from './squad.js'
import { isApiMode, emit } from './event.js'

// 路径常量统一从 paths.ts 来源；这里 re-export 保持向后兼容。
export {
  TOOL_DIR, WORK_DIR, HARNESS_DIR, TASKS_DIR, PROMPTS_DIR,
  taskDir, inquiryDirFor, progressDirFor,
} from './paths.js'

import { TOOL_DIR, WORK_DIR } from './paths.js'

const LOCAL_PRINCIPLES = resolve(WORK_DIR, '.harness/golden-principles.md')
const DEFAULT_PRINCIPLES_PATH = resolve(TOOL_DIR, 'control/golden-principles.md')
export const DEFAULT_PRINCIPLES = DEFAULT_PRINCIPLES_PATH
export const PRINCIPLES_FILE = existsSync(LOCAL_PRINCIPLES) ? LOCAL_PRINCIPLES : DEFAULT_PRINCIPLES_PATH

// 浅合并 + 对 mcpServers 按 server name 一层深合并。
// 让用户在 .harness/config.json 里写 { mcpServers: { playwright: { enabled: false } } }
// 关掉默认 server，而不丢 default 里的 command/args。
function mergeConfig(base: HarnessConfig, override: Partial<HarnessConfig>): HarnessConfig {
  const merged = { ...base, ...override }
  if (base.mcpServers || override.mcpServers) {
    merged.mcpServers = { ...(base.mcpServers ?? {}) }
    for (const [name, spec] of Object.entries(override.mcpServers ?? {})) {
      merged.mcpServers[name] = { ...(base.mcpServers?.[name] ?? {} as McpServerSpec), ...spec }
    }
  }
  return merged
}

function logConfigSource(label: string): void {
  // api mode 下 console.log 已被劫持到 stderr（bin/harness.mjs 早期 hack），
  // 这里仍然打 —— stderr 上保留人类可读的"加载了哪份 config"信息。
  console.log(`  \x1b[2m${label}\x1b[0m`)
}

function loadConfig(): HarnessConfig {
  let cfg: HarnessConfig = JSON.parse(readFileSync(resolve(TOOL_DIR, 'config.default.json'), 'utf-8'))

  const candidates = [
    resolve(WORK_DIR, '.harness/config.json'),
    resolve(process.env.HOME ?? '~', '.harness/config.json'),
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const override = JSON.parse(readFileSync(path, 'utf-8')) as Partial<HarnessConfig>
        cfg = mergeConfig(cfg, override)
        logConfigSource(`config: ${relative(WORK_DIR, path) || path}`)
        break
      } catch { /* 文件损坏，跳过 */ }
    }
  }

  // Squad preset 优先级最高 —— 由 harness-ops daemon 通过 HARNESS_SQUAD env var 传入。
  // CLI 直跑也可以 export HARNESS_SQUAD=<id> 测试 squad 行为。
  const squadId = process.env.HARNESS_SQUAD
  if (squadId) {
    const squad = loadSquad(squadId)
    if (squad) {
      const { id: _id, name: _name, description: _desc, ...preset } = squad
      cfg = mergeConfig(cfg, preset as Partial<HarnessConfig>)
      logConfigSource(`squad: ${squadId}`)
    } else {
      console.error(`\x1b[33m  Warning: HARNESS_SQUAD=${squadId} but no squad preset found; using base config.\x1b[0m`)
    }
  }

  return cfg
}

export const config = loadConfig()

// 已剥离 enabled 字段、已过滤禁用项的 SDK-ready 形态。SDK Options.mcpServers
// 不认识 enabled 字段，得清理掉再传。
export const MCP_SERVERS: Record<string, { command: string; args?: string[]; env?: Record<string, string> }> =
  Object.fromEntries(
    Object.entries(config.mcpServers ?? {})
      .filter(([, spec]) => spec.enabled !== false)
      .map(([name, spec]) => {
        const { enabled: _enabled, ...rest } = spec
        return [name, rest]
      }),
  )

export const MCP_ENABLED_SERVERS = Object.keys(MCP_SERVERS)

// 设置环境变量（在 agent 子进程启动前）
if (config.apiBaseUrl) process.env.ANTHROPIC_BASE_URL = config.apiBaseUrl
if (config.apiKey) process.env.ANTHROPIC_API_KEY = config.apiKey

// 使用自定义模型时，禁用 Claude Code 的实验性 Beta headers（第三方网关不认）
if (config.customModel) {
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
}

// api mode 下暴露生效 config 的摘要，便于 daemon 记录 + 调试。CLI 模式 no-op。
if (isApiMode()) {
  emit('engine.config', {
    model: config.model,
    maxSprints: config.maxSprints,
    maxNegotiateRounds: config.maxNegotiateRounds,
    maxL1Retries: config.maxL1Retries,
    mcpServers: MCP_ENABLED_SERVERS,
    squadId: process.env.HARNESS_SQUAD ?? null,
  })
}
