export type Role = 'Generator' | 'Evaluator' | 'Interrogator'

export interface Evaluation {
  checks: string[]
  intent: string
}

export interface Feature {
  id: string
  name: string
  prompt: string
  background: string
  evaluation: Evaluation | string
  status: 'pending' | 'failing' | 'passing'
}

export interface ReviewDimension {
  name: string
  description: string
}

export interface Sprint {
  sprint: number
  taskId: string                        // 所属 task ID，sprint 文件冗余存储以便人工调试
  task: string                          // 原始任务描述（保留向后可读）
  phase: 'negotiate' | 'implement' | 'review' | 'done'
  reviewDimensions: ReviewDimension[]
  context?: string
  previousReview?: string
  features: Feature[]
  // SDK session IDs 不再存这里 —— 已上移到 Task（task.json），让所有 sprint 共享同一组 session。
}

export interface ReviewResult {
  approved: boolean
  reviews: { featureId: string; status: string; comment: string }[]
  dimensionReviews: { id: string; status: string; comment: string }[]
  overallComment: string
}

export interface SingleReview {
  id: string
  type: 'feature' | 'dimension'
  status: string
  score: number
  comment: string
}

// MCP server 装载规范。两层门禁（enabled / allowedTools）对所有 server 通用，
// 不为某个 server 单开顶层配置块。详见 SPEC §八 / §10.7。
//
// 设计原则：capability 通用 + policy 走 prompt。tool 不分 role 限制，行为差异通过
// 系统提示词区分。Interrogator 不挂 MCP 是硬约束（编码在 src/config.ts 里），
// 不通过 per-server 配置控制。
export interface McpServerSpec {
  // ─ 挂载形态 ─
  type?: 'stdio' | 'builtin'        // 默认 'stdio'；'builtin' 走 src/mcp-builtin/<name>.ts
  command?: string                  // stdio 模式必填
  args?: string[]
  env?: Record<string, string>
  // ─ 挂载策略 ─
  enabled?: boolean                 // 默认 true
  allowedTools?: string[]           // 默认通配；指定时项为 tool 短名（不带 mcp__<name>__ 前缀），退化为精确白名单
}

export interface HarnessConfig {
  model: string
  apiBaseUrl: string
  apiKey: string
  concurrency: number
  maxSprints: number
  maxNegotiateRounds: number
  maxL1Retries: number
  customModel?: {
    backendUrl: string
    backendModel: string
    litellmPort: number
    backendApiKey: string
  }
  mcpServers?: Record<string, McpServerSpec>
}
