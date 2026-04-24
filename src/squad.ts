/**
 * Squad preset：harness-ops 概念在 engine 端的最小落地。
 *
 * Squad 是一份 JSON 文件，字段是 HarnessConfig 的子集（同名同义）。
 * 加载顺序：
 *   1. 项目内置：./squads/<id>.json
 *   2. 用户覆盖：~/.harness-ops/squads/<id>.json
 * 同 id 时 **整文件覆盖**，不做字段级 merge（参见 harness-ops SPEC §4.3）。
 *
 * 触发：环境变量 HARNESS_SQUAD=<id>。Squad 加载后由 config.ts 与默认 config 合并。
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { TOOL_DIR, WORK_DIR } from './paths.js'
import type { HarnessConfig } from './types.js'

export type SquadPreset = Partial<HarnessConfig> & { id?: string; name?: string; description?: string }

function squadCandidates(squadId: string): string[] {
  return [
    resolve(process.env.HOME ?? '~', '.harness-ops/squads', `${squadId}.json`),
    resolve(WORK_DIR, 'squads', `${squadId}.json`),
    resolve(TOOL_DIR, 'squads', `${squadId}.json`),
  ]
}

export function loadSquad(squadId: string): SquadPreset | null {
  for (const path of squadCandidates(squadId)) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf-8')) as SquadPreset
      } catch {
        // 文件损坏，跳过
      }
    }
  }
  return null
}
