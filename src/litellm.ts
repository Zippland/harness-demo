import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { WORK_DIR } from './config.js'
import { dim, green, red } from './ui.js'
import type { HarnessConfig } from './types.js'

let litellmProcess: ChildProcess | null = null

function ensureLiteLLM(): boolean {
  try {
    execSync('python3 -c "from litellm.proxy.proxy_server import app"', { stdio: 'pipe' })
    return true
  } catch {
    console.log(dim('  Installing LiteLLM[proxy]...'))
    try {
      execSync("pip3 install 'litellm[proxy]'", { stdio: 'inherit', timeout: 180_000 })
      return true
    } catch {
      console.error(red("  Failed to install LiteLLM. Please run: pip3 install 'litellm[proxy]'"))
      return false
    }
  }
}

function generateConfig(custom: NonNullable<HarnessConfig['customModel']>, model: string): string {
  const content = `model_list:
  - model_name: ${model}
    litellm_params:
      model: openai/${custom.backendModel}
      api_base: "${custom.backendUrl}"
      api_key: "${custom.backendApiKey || 'sk-placeholder'}"
`
  const configPath = resolve(WORK_DIR, '.harness/litellm-config.yaml')
  writeFileSync(configPath, content)
  return configPath
}

export async function startLiteLLM(custom: NonNullable<HarnessConfig['customModel']>, model: string): Promise<boolean> {
  const port = custom.litellmPort

  // 检查是否已经在运行
  try {
    execSync(`curl -sf http://127.0.0.1:${port}/health 2>/dev/null || curl -sf http://127.0.0.1:${port}/v1/models 2>/dev/null`, { stdio: 'pipe', timeout: 3000 })
    console.log(dim(`  LiteLLM already running on port ${port}`))
    return true
  } catch { /* 没在运行，继续启动 */ }

  if (!ensureLiteLLM()) return false

  const configPath = generateConfig(custom, model)
  console.log(dim(`  Starting LiteLLM on port ${port}...`))

  litellmProcess = spawn('litellm', ['--config', configPath, '--port', String(port)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  })

  litellmProcess.on('error', (err) => {
    console.log(red(`    LiteLLM error: ${err.message}`))
  })
  litellmProcess.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(dim(`    [litellm] ${line.slice(0, 150)}`))
  })
  litellmProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line) console.log(dim(`    [litellm] ${line.slice(0, 150)}`))
  })

  // 等待启动（最多 30 秒）
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      execSync(`curl -sf http://127.0.0.1:${port}/health 2>/dev/null || curl -sf http://127.0.0.1:${port}/v1/models 2>/dev/null`, { stdio: 'pipe', timeout: 2000 })
      console.log(green(`  ✓ LiteLLM ready on port ${port}`))
      return true
    } catch { /* 还没起来 */ }
  }

  console.error(red('  LiteLLM failed to start within 30s'))
  stopLiteLLM()
  return false
}

export function stopLiteLLM(): void {
  if (litellmProcess) {
    litellmProcess.kill()
    litellmProcess = null
  }
}

// 进程退出时清理
process.on('exit', stopLiteLLM)
process.on('SIGINT', () => { stopLiteLLM(); process.exit(0) })
process.on('SIGTERM', () => { stopLiteLLM(); process.exit(0) })
