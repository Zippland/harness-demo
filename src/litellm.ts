import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { request } from 'http'
import { WORK_DIR } from './config.js'
import { dim, green, red } from './ui.js'
import { startStripProxy } from './strip-proxy.js'
import type { HarnessConfig } from './types.js'

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 2000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.end()
  })
}

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

function generateConfig(custom: NonNullable<HarnessConfig['customModel']>, model: string, stripProxyPort: number): string {
  // LiteLLM 的 api_base 指向 strip proxy，不直接指向后端
  // Claude Code 会请求多个模型名，全部映射到同一个后端
  const allModels = [
    model,
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5-20250929',
    'claude-haiku-4-5-20251001',
  ]
  const uniqueModels = [...new Set(allModels)]

  const modelEntries = uniqueModels.map((m) => `  - model_name: ${m}
    litellm_params:
      model: openai/${custom.backendModel}
      api_base: "http://127.0.0.1:${stripProxyPort}/v1"
      api_key: "${custom.backendApiKey || 'sk-placeholder'}"
      drop_params: true`).join('\n')

  const content = `model_list:
${modelEntries}

litellm_settings:
  drop_params: true
`

  const configPath = resolve(WORK_DIR, '.harness/litellm-config.yaml')
  writeFileSync(configPath, content)
  return configPath
}

export async function startLiteLLM(custom: NonNullable<HarnessConfig['customModel']>, model: string): Promise<boolean> {
  const port = custom.litellmPort
  const stripPort = port + 1  // strip proxy 用 litellm port + 1

  // 检查 LiteLLM 是否已经在运行
  if (await checkPort(port)) {
    console.log(dim(`  LiteLLM already running on port ${port}`))
    return true
  }

  if (!ensureLiteLLM()) return false

  // 先启动 strip proxy（LiteLLM → strip proxy → 后端）
  // strip proxy 删除后端不支持的字段（如 user）再转发
  const backendBase = custom.backendUrl.replace(/\/v1\/?$/, '')  // 去掉 /v1 后缀，strip proxy 会拼接路径
  console.log(dim(`  Starting strip proxy on port ${stripPort} → ${backendBase}`))
  await startStripProxy(backendBase, stripPort)
  console.log(green(`  ✓ Strip proxy ready`))

  // 启动 LiteLLM
  const configPath = generateConfig(custom, model, stripPort)
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
    if (line && /error|exception|traceback/i.test(line)) console.log(dim(`    [litellm] ${line.slice(0, 300)}`))
  })
  litellmProcess.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim()
    if (line && /error|exception|traceback/i.test(line)) console.log(dim(`    [litellm] ${line.slice(0, 300)}`))
  })

  // 等待启动
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const alive = await checkPort(port)
    if (alive) {
      console.log(green(`  ✓ LiteLLM ready on port ${port}`))
      return true
    }
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

process.on('exit', stopLiteLLM)
process.on('SIGINT', () => { stopLiteLLM(); process.exit(0) })
process.on('SIGTERM', () => { stopLiteLLM(); process.exit(0) })
