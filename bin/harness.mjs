#!/usr/bin/env npx tsx
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// 加载 orchestrator（从工具安装目录，不是 cwd）
const toolDir = dirname(dirname(fileURLToPath(import.meta.url)))
await import(resolve(toolDir, 'orchestrator.ts'))
