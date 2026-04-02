You are proposing a development plan for the following task.
Your plan will be reviewed by an independent Evaluator — think of this as a negotiation.

<TASK>

# Task
{{task}}

</TASK>

# CRITICAL: This is the PLANNING phase, NOT the implementation phase.
Do NOT implement any features. Do NOT write final content.
Your ONLY job is to produce a plan (sprint file) and minimal scaffolding.
Implementation happens later in a separate phase.

# What you must produce

## 1. Research and decompose the task
Read whatever you need to understand the task, then break it into 5–10 independently deliverable features.
Think about: what order makes sense? What builds on what?

## 2. Write MINIMAL project scaffolding
Set up the bare minimum structure under `project/` — just enough so that checks can run:
- For coding tasks: write vitest tests and function stubs (NOT implementations)
- For documentation/wiki tasks: create empty placeholder files or directory structure (NOT the actual content)
- For other tasks: create whatever minimal structure is needed

Do NOT write actual implementations, final content, or finished artifacts.

## 3. Write {{progressFile}}
```json
{
  "sprint": {{sprintNum}},
  "task": "<the original task, verbatim>",
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

# How to write `evaluation`

### `checks` — deterministic commands the orchestrator runs automatically (zero cost)
- Must be valid shell commands that exit 0 on success, non-zero on failure
- For coding tasks: `"cd project && npx vitest run --testNamePattern 'featureId' --reporter verbose"`
- For file checks: `"test -f project/README.md"`, `"grep -q '## API' project/README.md"`

### `intent` — the quality bar (the Evaluator reads this to understand your expectations)
- Describe what "done right" looks like, not what commands to run
- The Evaluator designs its own verification strategy based on this

# Remember
- This is PLANNING only — do NOT implement features or write final content
- Your plan and criteria will be reviewed by the Evaluator
- Write tests that are rigorous but fair — edge cases matter
- The Evaluator will push back if your criteria are too vague or your tests have gaps
- You and the Evaluator must agree before implementation begins
- Implementation happens in a separate phase AFTER this plan is approved
