import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { config, WORK_DIR, DEFAULT_PRINCIPLES } from './config.js'
import { bold, green, red, dim } from './ui.js'
import type { HarnessConfig } from './types.js'

export async function onboard(): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res))

  console.log(bold('\n  ─── Harness Onboard ───\n'))

  const configDir = resolve(WORK_DIR, '.harness')
  mkdirSync(configDir, { recursive: true })
  const configPath = resolve(configDir, 'config.json')

  let existing: Partial<HarnessConfig> = {}
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf-8')) } catch {}
  }

  // 选择模式
  console.log('  选择模型来源:')
  console.log('    1. Anthropic 官方 API（默认）')
  console.log('    2. 自定义模型（OpenAI 兼容，通过 LiteLLM 代理）')
  const modeChoice = (await ask('\n  选择 [1]: ')).trim() || '1'

  let model = ''
  let apiBaseUrl = ''
  let apiKey = ''
  let customModel: HarnessConfig['customModel'] = undefined

  if (modeChoice === '2') {
    const backendUrl = (await ask(`  模型服务地址 (如 http://localhost:11434/v1) [${existing.customModel?.backendUrl || ''}]: `)).trim() || existing.customModel?.backendUrl || ''
    const backendModel = (await ask(`  模型名称 (如 qwen-coder-32b) [${existing.customModel?.backendModel || ''}]: `)).trim() || existing.customModel?.backendModel || ''
    const litellmPort = parseInt((await ask(`  LiteLLM 代理端口 [${existing.customModel?.litellmPort || 4000}]: `)).trim()) || existing.customModel?.litellmPort || 4000
    const backendApiKey = (await ask(`  模型 API Key (本地模型留空) [${existing.customModel?.backendApiKey ? '****' : ''}]: `)).trim() || existing.customModel?.backendApiKey || ''

    if (!backendUrl || !backendModel) {
      console.error(red('  模型服务地址和模型名称不能为空'))
      rl.close()
      return
    }

    model = existing.model || config.model
    apiBaseUrl = `http://127.0.0.1:${litellmPort}/anthropic`
    apiKey = 'sk-litellm'
    customModel = { backendUrl, backendModel, litellmPort, backendApiKey }
    console.log(green(`\n  ✓ LiteLLM 将自动启动并将 ${model} 请求转发到 ${backendUrl} (${backendModel})\n`))
  } else {
    model = (await ask(`  Model [${existing.model || config.model}]: `)).trim() || existing.model || config.model
    apiBaseUrl = (await ask(`  API Base URL (留空用官方) [${existing.apiBaseUrl || ''}]: `)).trim() || existing.apiBaseUrl || ''
    apiKey = (await ask(`  API Key (留空用环境变量) [${existing.apiKey ? '****' : ''}]: `)).trim() || existing.apiKey || ''
  }

  const concurrency = parseInt((await ask(`\n  Review 并发数 [${existing.concurrency || config.concurrency}]: `)).trim()) || existing.concurrency || config.concurrency
  const maxSprints = parseInt((await ask(`  最大 Sprint 轮数 [${existing.maxSprints || config.maxSprints}]: `)).trim()) || existing.maxSprints || config.maxSprints
  const maxNegotiateRounds = parseInt((await ask(`  协商最大讨论次数 [${existing.maxNegotiateRounds || config.maxNegotiateRounds}]: `)).trim()) || existing.maxNegotiateRounds || config.maxNegotiateRounds
  const maxL1Retries = parseInt((await ask(`  L1 最大重试次数 [${existing.maxL1Retries || config.maxL1Retries}]: `)).trim()) || existing.maxL1Retries || config.maxL1Retries

  const newConfig: HarnessConfig = {
    model, apiBaseUrl, apiKey, concurrency, maxSprints, maxNegotiateRounds, maxL1Retries,
    ...(customModel ? { customModel } : {}),
  }

  writeFileSync(configPath, JSON.stringify(newConfig, null, 2))
  console.log(green(`\n  ✓ Config saved to ${configPath}\n`))

  const principlesPath = resolve(configDir, 'golden-principles.md')
  if (!existsSync(principlesPath)) {
    const create = (await ask('  Create project-level golden-principles.md? (y/N): ')).trim().toLowerCase()
    if (create === 'y') {
      writeFileSync(principlesPath, readFileSync(DEFAULT_PRINCIPLES, 'utf-8'))
      console.log(green(`  ✓ Created ${principlesPath} (edit to customize)\n`))
    }
  }

  rl.close()
  console.log(dim('  Run `harness "<task>"` to start.\n'))
}
