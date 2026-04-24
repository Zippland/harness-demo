/**
 * 结构化事件流：harness-ops daemon 通过这个通道观察 engine。
 *
 * 设计：
 *   - api mode 开启时 emit(type, payload) → 一行 JSON 写到 stdout
 *   - api mode 开启时 console.log → 重定向到 stderr（保留人类调试可读性，不污染 stdout）
 *   - cli mode 下 emit() 是 no-op，console.log 不变
 *
 * console.log 的劫持发生在 bin/harness.mjs 最早期（在任何 import 之前），
 * 这里的 setApiMode 只负责状态记录与 cli 模式回退。
 */

const apiMode = process.env.HARNESS_API_MODE === '1'

export function isApiMode(): boolean {
  return apiMode
}

/**
 * Emit 一个结构化事件。仅在 api mode 下输出，否则 no-op。
 * 用 process.stdout.write 直接写，不走 console.log（console.log 在 api mode 下被劫持到 stderr）。
 */
export function emit(type: string, payload: Record<string, unknown> = {}): void {
  if (!apiMode) return
  process.stdout.write(JSON.stringify({ ts: Date.now(), type, ...payload }) + '\n')
}
