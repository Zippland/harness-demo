import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { progressDirFor } from './config.js'
import { dim } from './ui.js'
import type { Sprint, Evaluation } from './types.js'

export function sprintPath(taskId: string, n: number): string {
  return resolve(progressDirFor(taskId), `sprint-${n}.json`)
}

export function loadSprint(taskId: string, n: number): Sprint {
  return JSON.parse(readFileSync(sprintPath(taskId, n), 'utf-8'))
}

export function tryLoadSprint(taskId: string, n: number): { sprint: Sprint | null; error: string } {
  try {
    return { sprint: loadSprint(taskId, n), error: '' }
  } catch (e) {
    return { sprint: null, error: (e as Error).message }
  }
}

export function currentSprintNumber(taskId: string): number {
  const dir = progressDirFor(taskId)
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir).filter((f) => /^sprint-\d+\.json$/.test(f))
  if (files.length === 0) return 0
  return Math.max(...files.map((f) => parseInt(f.match(/\d+/)![0])))
}

export function ensureProgressDir(taskId: string): void {
  mkdirSync(progressDirFor(taskId), { recursive: true })
}

export function updateSprintState(taskId: string, sprintNum: number, phase: Sprint['phase'], previousReview?: string): void {
  const file = sprintPath(taskId, sprintNum)
  if (!existsSync(file)) return
  try {
    const sprint = loadSprint(taskId, sprintNum)
    sprint.phase = phase
    if (previousReview !== undefined) sprint.previousReview = previousReview
    writeFileSync(file, JSON.stringify(sprint, null, 2))
  } catch {
    console.log(dim('    Warning: could not update sprint state'))
  }
}

export function parseEvaluation(evaluation: Evaluation | string | undefined): Evaluation {
  if (!evaluation) return { checks: [], intent: '' }
  if (typeof evaluation === 'string') return { checks: [], intent: evaluation }
  return evaluation
}
