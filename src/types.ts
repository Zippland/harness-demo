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
  negotiateGeneratorSessionId?: string  // negotiate Generator session，断点恢复用
  negotiateEvaluatorSessionId?: string  // negotiate Evaluator session，断点恢复用
  implementSessionId?: string           // implement 阶段共享 session，断点恢复用
}

export interface ReviewResult {
  approved: boolean
  reviews: { featureId: string; status: string; comment: string }[]
  overallComment: string
}

export interface SingleReview {
  id: string
  type: 'feature' | 'dimension'
  status: string
  score: number
  comment: string
}

export interface McpServerSpec {
  command: string
  args?: string[]
  env?: Record<string, string>
  enabled?: boolean
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
