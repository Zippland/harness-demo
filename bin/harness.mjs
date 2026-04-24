#!/usr/bin/env npx tsx
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// ─── 全局参数提取 ───
//
// 这些参数主要为 harness-ops daemon 调用准备（也支持 CLI 直跑测试）：
//   --api-mode               stdout 输出 JSONL 事件流，console.log 重定向到 stderr
//   --squad <id>             加载 squad preset 覆盖默认 config
//   --inquiry-mode <mode>    interactive | skip | headless
//
// 解析后从 process.argv 中 splice 掉，env vars 转发给 orchestrator.ts，
// 这样 orchestrator 内部的 subcommand 路由（discover/execute/...）不被干扰。

function takeBool(name) {
  const idx = process.argv.indexOf(name)
  if (idx < 0) return false
  process.argv.splice(idx, 1)
  return true
}

function takeArg(name) {
  const idx = process.argv.indexOf(name)
  if (idx < 0) return undefined
  const value = process.argv[idx + 1]
  process.argv.splice(idx, 2)
  return value
}

if (takeBool('--api-mode')) process.env.HARNESS_API_MODE = '1'
const squadId = takeArg('--squad')
if (squadId) process.env.HARNESS_SQUAD = squadId
const inquiryMode = takeArg('--inquiry-mode')
if (inquiryMode) process.env.HARNESS_INQUIRY_MODE = inquiryMode

// ─── api mode 下的最早期 console 劫持 ───
//
// orchestrator.ts → src/config.ts 的 import 链一旦展开，config.ts 顶层就会 console.log
// 加载来源。必须在 import 任何东西之前把 console.log 重定向到 stderr，否则会污染
// stdout 的 JSONL 流。事件流的 emit() 走 process.stdout.write，不受劫持影响。
if (process.env.HARNESS_API_MODE === '1') {
  const origError = console.error.bind(console)
  console.log = (...args) => origError(...args)
}

// 加载 orchestrator（从工具安装目录，不是 cwd）
const toolDir = dirname(dirname(fileURLToPath(import.meta.url)))
await import(resolve(toolDir, 'orchestrator.ts'))
