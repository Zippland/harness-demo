import { relative, resolve } from 'path'
import { WORK_DIR } from './config.js'
import type { Role, ReviewResult } from './types.js'

// ─── ANSI ───

export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
export const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`

export const ROLE_STYLE: Record<Role, (s: string) => string> = {
  Generator: yellow,
  Evaluator: magenta,
  Interrogator: cyan,
}

export function shortPath(p: string): string {
  if (!p) return ''
  return relative(WORK_DIR, p.startsWith('/') ? p : resolve(WORK_DIR, p)) || p
}

export function progressBar(done: number, total: number, width = 20): string {
  const filled = Math.round((done / total) * width)
  return `[${green('█'.repeat(filled))}${dim('░'.repeat(width - filled))}]`
}

/**
 * 启动一个行内 spinner，返回停止函数。
 * 停止时清除当前行。
 */
export function startSpinner(label: string, color: (s: string) => string = cyan): () => void {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const isTTY = Boolean((process.stdout as any).isTTY)
  if (!isTTY) {
    // 非 TTY（比如 pipe/CI）不动画，只打一次标签
    console.log(`    ${dim(label)}`)
    return () => {}
  }
  process.stdout.write('\x1b[?25l') // hide cursor
  const interval = setInterval(() => {
    process.stdout.write(`\r    ${color(frames[i])} ${dim(label)}`)
    i = (i + 1) % frames.length
  }, 80)
  return () => {
    clearInterval(interval)
    process.stdout.write('\r\x1b[K\x1b[?25h') // clear line + restore cursor
  }
}

export function logTool(name: string, input: any): void {
  const fmts: Record<string, () => string> = {
    Read:  () => `${cyan('Read')}  ${shortPath(input?.file_path)}`,
    Write: () => `${yellow('Write')} ${shortPath(input?.file_path)}`,
    Edit:  () => `${yellow('Edit')}  ${shortPath(input?.file_path)}`,
    Bash:  () => `${dim('$')} ${dim((input?.command ?? '').slice(0, 100))}`,
    Glob:  () => `${cyan('Glob')}  ${input?.pattern ?? ''}`,
    Grep:  () => `${cyan('Grep')}  "${(input?.pattern ?? '').slice(0, 60)}"`,
  }
  console.log(`    ${(fmts[name] ?? (() => cyan(name)))()}`)
}

export function printReview(review: ReviewResult): void {
  for (const r of review.reviews ?? []) {
    const icon = r.status === 'pass' ? green('✓') : red('✗')
    const scores = (r as any).scores
    const scoreStr = scores
      ? dim(' [' + Object.entries(scores).map(([k, v]) => `${k}:${v}`).join(' ') + ']')
      : ''
    console.log(`    ${icon} ${bold(r.featureId)}${scoreStr} ${dim(r.comment)}`)
  }
  if (review.overallComment) {
    console.log(`    ${dim('Overall:')} ${dim(review.overallComment)}`)
  }
}

export function formatReviewFeedback(review: ReviewResult): string {
  const lines = (review.reviews ?? [])
    .filter((r) => r.status === 'needs-revision')
    .map((r) => `- **${r.featureId}**: ${r.comment}`)
  return [
    ...lines,
    review.overallComment ? `\n**Overall**: ${review.overallComment}` : '',
  ].join('\n')
}
