import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { PROGRESS_DIR } from './config.js'
import { dim } from './ui.js'
import type { Sprint, Evaluation } from './types.js'

export function sprintPath(n: number): string {
  return resolve(PROGRESS_DIR, `sprint-${n}.json`)
}

export function loadSprint(n: number): Sprint {
  return JSON.parse(readFileSync(sprintPath(n), 'utf-8'))
}

export function tryLoadSprint(n: number): { sprint: Sprint | null; error: string } {
  try {
    return { sprint: loadSprint(n), error: '' }
  } catch (e) {
    return { sprint: null, error: (e as Error).message }
  }
}

export function currentSprintNumber(): number {
  if (!existsSync(PROGRESS_DIR)) return 0
  const files = readdirSync(PROGRESS_DIR).filter((f) => /^sprint-\d+\.json$/.test(f))
  if (files.length === 0) return 0
  return Math.max(...files.map((f) => parseInt(f.match(/\d+/)![0])))
}

export function updateSprintState(sprintNum: number, phase: Sprint['phase'], previousReview?: string): void {
  const file = sprintPath(sprintNum)
  if (!existsSync(file)) return
  try {
    const sprint = loadSprint(sprintNum)
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
