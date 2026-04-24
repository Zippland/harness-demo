import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

export const TOOL_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
export const WORK_DIR = process.cwd()
export const HARNESS_DIR = resolve(WORK_DIR, '.harness')
export const TASKS_DIR = resolve(HARNESS_DIR, 'tasks')
export const PROMPTS_DIR = resolve(TOOL_DIR, 'prompts')

export function taskDir(taskId: string): string {
  return resolve(TASKS_DIR, taskId)
}
export function inquiryDirFor(taskId: string): string {
  return resolve(taskDir(taskId), 'inquiry')
}
export function progressDirFor(taskId: string): string {
  return resolve(taskDir(taskId), 'progress')
}
