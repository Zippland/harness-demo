import { readFileSync, existsSync } from 'fs'
import { resolve, relative, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { HarnessConfig } from './types.js'

export const TOOL_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const WORK_DIR = process.cwd()
export const PROGRESS_DIR = resolve(WORK_DIR, '.harness/progress')
export const INQUIRY_DIR = resolve(WORK_DIR, '.harness/inquiry')
export const PENDING_DIR = resolve(WORK_DIR, '.harness/pending')
export const COMPLETED_DIR = resolve(WORK_DIR, '.harness/completed')
export const PROMPTS_DIR = resolve(TOOL_DIR, 'prompts')

const LOCAL_PRINCIPLES = resolve(WORK_DIR, '.harness/golden-principles.md')
const DEFAULT_PRINCIPLES_PATH = resolve(TOOL_DIR, 'control/golden-principles.md')
export const DEFAULT_PRINCIPLES = DEFAULT_PRINCIPLES_PATH
export const PRINCIPLES_FILE = existsSync(LOCAL_PRINCIPLES) ? LOCAL_PRINCIPLES : DEFAULT_PRINCIPLES_PATH

function loadConfig(): HarnessConfig {
  const defaults: HarnessConfig = JSON.parse(readFileSync(resolve(TOOL_DIR, 'config.default.json'), 'utf-8'))

  const candidates = [
    resolve(WORK_DIR, '.harness/config.json'),
    resolve(process.env.HOME ?? '~', '.harness/config.json'),
  ]

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const override = JSON.parse(readFileSync(path, 'utf-8'))
        Object.assign(defaults, override)
        console.log(`  \x1b[2mconfig:\x1b[0m ${relative(WORK_DIR, path) || path}`)
        break
      } catch { /* 文件损坏，跳过 */ }
    }
  }

  return defaults
}

export const config = loadConfig()

// 设置环境变量（在 agent 子进程启动前）
if (config.apiBaseUrl) process.env.ANTHROPIC_BASE_URL = config.apiBaseUrl
if (config.apiKey) process.env.ANTHROPIC_API_KEY = config.apiKey

// 使用自定义模型时，禁用 Claude Code 的实验性 Beta headers（第三方网关不认）
if (config.customModel) {
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1'
}
