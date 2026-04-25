import { readFileSync, existsSync } from 'fs'
import { resolve, relative } from 'path'
import type { HarnessConfig, McpServerSpec, Role } from './types.js'
import { loadSquad } from './squad.js'
import { isApiMode, emit } from './event.js'
import { buildComputerUseServer } from './mcp-builtin/computer-use.js'

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

// ─── MCP 装载（按角色） ───
// SDK Options.mcpServers 不认识 enabled/roles/allowedTools 这些 harness 自定字段，
// 必须剥离后再传；同时按角色过滤 + 按 server.allowedTools 展开 allowedTools 列表。
// 详见 SPEC §八 / §10.7。

// builtin server 名 → factory 注册表。新增 builtin 在这里挂一项即可。
const BUILTIN_FACTORIES: Record<string, () => any> = {
  'computer-use': buildComputerUseServer,
}

// 已构造的 builtin server 实例缓存：避免重复 createSdkMcpServer。
const builtinInstances = new Map<string, any>()
function builtinInstance(name: string): any | null {
  if (builtinInstances.has(name)) return builtinInstances.get(name)
  const factory = BUILTIN_FACTORIES[name]
  if (!factory) {
    console.error(`\x1b[33m  Warning: mcpServer "${name}" type='builtin' 但无对应 factory；忽略此 server。\x1b[0m`)
    return null
  }
  const inst = factory()
  builtinInstances.set(name, inst)
  return inst
}

function isServerEnabledForRole(spec: McpServerSpec, role: Role): boolean {
  if (spec.enabled === false) return false
  // Interrogator 永远不挂 MCP —— 硬约束（capability vs policy 解耦的边界例外，
  // 详见 SPEC §10.7）。其余角色 capability 通用，行为差异由系统提示词区分。
  if (role === 'Interrogator') return false
  return true
}

// 给 SDK 用的 mcpServers 表（按角色过滤；剥离 harness 自定字段）。
export function mcpServersForRole(role: Role): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [name, spec] of Object.entries(config.mcpServers ?? {})) {
    if (!isServerEnabledForRole(spec, role)) continue
    const type = spec.type ?? 'stdio'
    if (type === 'builtin') {
      const inst = builtinInstance(name)
      if (inst) result[name] = inst
    } else {
      // stdio：保留 SDK 接受的字段
      const { command, args, env } = spec
      if (!command) {
        console.error(`\x1b[33m  Warning: mcpServer "${name}" 缺 command 字段；跳过。\x1b[0m`)
        continue
      }
      result[name] = { command, ...(args ? { args } : {}), ...(env ? { env } : {}) }
    }
  }
  return result
}

// 给 SDK 用的 allowedTools 片段（按角色 × per-server allowedTools 展开）。
// server.allowedTools 缺省 → 通配 mcp__<name>__*；指定 → 精确白名单 mcp__<name>__<tool>。
export function mcpAllowedToolsForRole(role: Role): string[] {
  const result: string[] = []
  for (const [name, spec] of Object.entries(config.mcpServers ?? {})) {
    if (!isServerEnabledForRole(spec, role)) continue
    if (spec.allowedTools && spec.allowedTools.length > 0) {
      for (const tool of spec.allowedTools) result.push(`mcp__${name}__${tool}`)
    } else {
      result.push(`mcp__${name}__*`)
    }
  }
  return result
}

// 仅供 onboard / engine.config emit 用：所有 enabled（任意角色可见）的 server 名集合。
export const MCP_ENABLED_SERVERS = Object.entries(config.mcpServers ?? {})
  .filter(([, spec]) => spec.enabled !== false)
  .map(([name]) => name)

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
