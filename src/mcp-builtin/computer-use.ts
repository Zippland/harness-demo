import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ───────────────────────────────────────────────────────────────────────
// computer-use builtin MCP server
//
// in-process 实现，由 src/config.ts 在 type:'builtin' 时实例化。
// 平台：macOS only（screencapture / osascript 系统自带；cliclick 是 brew formula）。
// 详见 SPEC §10.7。
// ───────────────────────────────────────────────────────────────────────

const PLATFORM_OK = process.platform === 'darwin'

let cliclickChecked = false
let cliclickAvailable = false

function ensureMacOnly(): { ok: true } | { ok: false; error: string } {
  if (!PLATFORM_OK) {
    return { ok: false, error: `computer-use 当前仅支持 macOS (process.platform=${process.platform})` }
  }
  return { ok: true }
}

function ensureCliclick(): { ok: true } | { ok: false; error: string } {
  const mac = ensureMacOnly()
  if (!mac.ok) return mac
  if (!cliclickChecked) {
    cliclickChecked = true
    try {
      execFileSync('which', ['cliclick'], { stdio: 'ignore' })
      cliclickAvailable = true
    } catch {
      cliclickAvailable = false
    }
  }
  if (!cliclickAvailable) {
    return {
      ok: false,
      error: 'cliclick 未安装。运行 `brew install cliclick` 后重试。这是 computer-use 精确 click 的硬依赖（详见 SPEC §10.7）。',
    }
  }
  return { ok: true }
}

const errResult = (msg: string) => ({
  content: [{ type: 'text' as const, text: msg }],
  isError: true,
})

// ─── tools ───

const screenshot = tool(
  'screenshot',
  '截取主屏当前画面，返回 PNG（base64）。evaluator 验证 UI 渲染的核心动作。',
  {},
  async () => {
    const guard = ensureMacOnly()
    if (!guard.ok) return errResult(guard.error)
    const dir = mkdtempSync(join(tmpdir(), 'harness-screenshot-'))
    const path = join(dir, 'shot.png')
    try {
      execFileSync('screencapture', ['-x', '-t', 'png', path], { stdio: 'ignore' })
      const data = readFileSync(path).toString('base64')
      return { content: [{ type: 'image' as const, data, mimeType: 'image/png' }] }
    } catch (e: any) {
      return errResult(`screencapture 失败: ${e?.message ?? e}`)
    } finally {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  },
)

const leftClick = tool(
  'left_click',
  '在指定屏幕坐标 (x, y) 单击鼠标左键。坐标为屏幕全局像素坐标，先 screenshot 视觉定位再用此工具。',
  { x: z.number().int(), y: z.number().int() },
  async ({ x, y }) => {
    const guard = ensureCliclick()
    if (!guard.ok) return errResult(guard.error)
    try {
      execFileSync('cliclick', [`c:${x},${y}`], { stdio: 'ignore' })
      return { content: [{ type: 'text' as const, text: `clicked (${x}, ${y})` }] }
    } catch (e: any) {
      return errResult(`cliclick 失败: ${e?.message ?? e}`)
    }
  },
)

const typeText = tool(
  'type',
  '在当前焦点输入框中键入字符串。原样输出（含空格、标点）；不做快捷键解析（按键用 key 工具）。',
  { text: z.string() },
  async ({ text }) => {
    const guard = ensureMacOnly()
    if (!guard.ok) return errResult(guard.error)
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    try {
      execFileSync(
        'osascript',
        ['-e', `tell application "System Events" to keystroke "${escaped}"`],
        { stdio: 'ignore' },
      )
      return { content: [{ type: 'text' as const, text: `typed ${text.length} chars` }] }
    } catch (e: any) {
      return errResult(`osascript 失败: ${e?.message ?? e}`)
    }
  },
)

// AppleScript key codes — 仅收录常用导航/控制键。需要扩展时按需加。
const KEY_CODES: Record<string, number> = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, 'page up': 116, 'page down': 121,
}

const key = tool(
  'key',
  `按一个特殊键，可附加 modifiers。key 取值（不区分大小写）：${Object.keys(KEY_CODES).join('/')}。modifiers 为 command/option/shift/control 子集。普通字符键请用 type 工具。`,
  {
    key: z.string(),
    modifiers: z.array(z.enum(['command', 'option', 'shift', 'control'])).optional(),
  },
  async ({ key: keyName, modifiers }) => {
    const guard = ensureMacOnly()
    if (!guard.ok) return errResult(guard.error)
    const code = KEY_CODES[keyName.toLowerCase()]
    if (code === undefined) {
      return errResult(`未知 key 名: "${keyName}"。可用: ${Object.keys(KEY_CODES).join(', ')}`)
    }
    const using = modifiers && modifiers.length
      ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
      : ''
    try {
      execFileSync(
        'osascript',
        ['-e', `tell application "System Events" to key code ${code}${using}`],
        { stdio: 'ignore' },
      )
      return {
        content: [{
          type: 'text' as const,
          text: `key ${keyName}${modifiers?.length ? ' + ' + modifiers.join('+') : ''}`,
        }],
      }
    } catch (e: any) {
      return errResult(`osascript 失败: ${e?.message ?? e}`)
    }
  },
)

// 单例工厂：config.ts 调一次拿到 server config，注入给 SDK。
export function buildComputerUseServer() {
  return createSdkMcpServer({
    name: 'computer-use',
    version: '0.1.0',
    tools: [screenshot, leftClick, typeText, key],
  })
}
