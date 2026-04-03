You are proposing a development plan for the following task.
Your plan will be reviewed by an independent Evaluator — think of this as a negotiation.

<TASK>

# Task
{{task}}

</TASK>

# CRITICAL: This is the PLANNING phase, NOT the implementation phase.
Your ONLY output is ONE file: the sprint file at {{progressFile}}.
Do NOT create, edit, or write ANY other files. No scaffolding, no stubs, no tests, no code, no content.
Read whatever you need to understand the task, but ONLY write the sprint file.

# What you must produce

## 1. Research the task
Read whatever files you need to understand the task. Explore the codebase, read docs, understand the domain.

## 2. Write the sprint file — {{progressFile}} — and NOTHING else
```json
{
  "sprint": {{sprintNum}},
  "task": "<the original task, verbatim>",
  "reviewDimensions": [
    { "name": "<dimension name>", "description": "<what this dimension measures, specific to this task>" }
  ],
  "features": [
    {
      "id": "<unique id, must match describe() block name for coding tasks>",
      "name": "<short display name>",
      "prompt": "<describe the intent — WHAT and WHY, not exact steps>",
      "evaluation": {
        "checks": ["<deterministic commands that must pass>"],
        "intent": "<what 'done right' looks like from a user's perspective>"
      },
      "status": "pending"
    }
  ]
}
```

<Golden_Principles>

# Golden Principles
{{principles}}

</Golden_Principles>

# How to write `reviewDimensions`

Define 3–5 dimensions that the Evaluator will score on (1-5 scale) during the review phase.
Dimensions should be SPECIFIC to this task, not generic. Examples:

- Coding task: `{ "name": "robustness", "description": "Handles malformed inputs without crashing" }`
- Wiki task: `{ "name": "accuracy", "description": "Content matches the source repository's actual code and architecture" }`
- Documentation: `{ "name": "followability", "description": "A new developer can complete every step without external help" }`

The Evaluator will review these dimensions during negotiation. You'll agree on them before implementation starts.

# How to write `evaluation`

### `checks` — deterministic commands the orchestrator runs automatically (zero cost)
- Must be valid shell commands that exit 0 on success, non-zero on failure
- For coding tasks: `"cd project && npx vitest run --testNamePattern 'featureId' --reporter verbose"`
- For file checks: `"test -f project/README.md"`, `"grep -q '## API' project/README.md"`

### `intent` — the quality bar (the Evaluator reads this to understand your expectations)
- Describe what "done right" looks like, not what commands to run
- The Evaluator designs its own verification strategy based on this

# Remember
- You write ONE file: {{progressFile}}. That's it. No other files.
- Your plan will be reviewed by the Evaluator
- The Evaluator will push back if your criteria are too vague or your tests have gaps
- You and the Evaluator must agree before implementation begins
- All scaffolding, tests, stubs, and content are created in the IMPLEMENT phase, not here
