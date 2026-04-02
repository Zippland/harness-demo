/**
 * 重置 demo 状态，允许用新任务重新开始。
 * 清除所有 sprint 文件和 agent 生成的产物。
 */

import { writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PROGRESS_DIR = resolve(ROOT, 'progress')

// 清除所有 sprint 文件
if (existsSync(PROGRESS_DIR)) {
  const files = readdirSync(PROGRESS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    rmSync(resolve(PROGRESS_DIR, f))
  }
  console.log(`✓ Removed ${files.length} sprint file(s)`)
} else {
  console.log('✓ No sprint files to remove')
}

// 清除旧的 progress.json（兼容）
if (existsSync(resolve(ROOT, 'progress.json'))) {
  rmSync(resolve(ROOT, 'progress.json'))
  console.log('✓ Removed legacy progress.json')
}

// 清除 agent 写的代码和测试
const stub = `// Waiting for harness to scaffold this project.\n`
writeFileSync(resolve(ROOT, 'project/src/index.ts'), stub)
console.log('✓ Reset project/src/index.ts')

writeFileSync(resolve(ROOT, 'project/tests/index.test.ts'), stub)
console.log('✓ Reset project/tests/index.test.ts')

console.log('\nReady. Run: npm start "<your task>"')
