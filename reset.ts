/**
 * 重置 demo 状态，允许用新任务重新开始。
 * 清除 planner 和 executor 生成的所有产物。
 */

import { writeFileSync, rmSync, existsSync } from 'fs'

// 清除 progress（planner 的输出）
if (existsSync('progress.json')) {
  rmSync('progress.json')
  console.log('✓ Removed progress.json')
}

// 清除 agent 写的代码
const emptyStub = `// Waiting for harness planner to scaffold this project.\n`
writeFileSync('project/src/index.ts', emptyStub)
console.log('✓ Reset project/src/index.ts')

// 清除 planner 写的测试
const emptyTest = `// Waiting for harness planner to write tests.\n`
writeFileSync('project/tests/index.test.ts', emptyTest)
console.log('✓ Reset project/tests/index.test.ts')

console.log('\nReady. Run: npm start "<your task>"')
