export type Role = 'Generator' | 'Evaluator'

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
  task: string
  phase: 'negotiate' | 'implement' | 'review' | 'done'
  reviewDimensions: ReviewDimension[]
  context?: string
  previousReview?: string
  features: Feature[]
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
}
