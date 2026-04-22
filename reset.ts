/**
 * 重置 demo 状态：删除 .harness/tasks/ 下所有 task 目录 + 重置 project 存根。
 */

import { writeFileSync, rmSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TASKS_DIR = resolve(ROOT, '.harness/tasks')

if (existsSync(TASKS_DIR)) {
  const entries = readdirSync(TASKS_DIR)
  rmSync(TASKS_DIR, { recursive: true, force: true })
  console.log(`✓ Removed ${entries.length} task(s) from .harness/tasks/`)
} else {
  console.log('✓ No tasks to remove')
}

// 旧 layout 兼容：如果还有遗留的 .harness/{inquiry,pending,progress,completed}/，一并清掉
for (const old of ['inquiry', 'pending', 'progress', 'completed']) {
  const oldDir = resolve(ROOT, '.harness', old)
  if (existsSync(oldDir)) {
    rmSync(oldDir, { recursive: true, force: true })
    console.log(`✓ Removed legacy .harness/${old}/`)
  }
}

// 清除 agent 写的代码和测试（demo 项目特有）
const stub = `// Waiting for harness to scaffold this project.\n`
const projectSrc = resolve(ROOT, 'project/src/index.ts')
const projectTest = resolve(ROOT, 'project/tests/index.test.ts')
if (existsSync(projectSrc)) {
  writeFileSync(projectSrc, stub)
  console.log('✓ Reset project/src/index.ts')
}
if (existsSync(projectTest)) {
  writeFileSync(projectTest, stub)
  console.log('✓ Reset project/tests/index.test.ts')
}

console.log('\nReady. Run: npm start "<your task>"')
