# Negotiate Phase Output Format

The negotiate phase produces **two files**, with cleanly separated roles:

| File | Role | Format |
|---|---|---|
| `spec.md` (in inquiry dir) | **Product source of truth** — what we're building, why, what's in scope, what was ruled out | Pure markdown narrative |
| `sprint-N.json` (in progress dir) | **Controller state** — feature breakdown, review dimensions, evaluation criteria, status | Structured JSON |

Keep them separate. Do not put structured data (features lists, dimensions) in `spec.md`. Do not put narrative product reasoning in `sprint-N.json`.

---

# Spec.md format

Pure markdown. Free structure — use whatever headings make the task clearest. Cover at minimum:

- **What we're building** — the underlying goal, not just the surface request
- **In scope** — concrete boundaries
- **Out of scope / ruled out** — directions the inquiry explicitly rejected; this prevents downstream drift, so be specific
- **Done well** — observable signs that the task succeeded

Anchor everything to the inquiry transcript. Do not invent goals the user did not voice.

---

# Sprint contract format

The sprint contract file defines the controller state that drives implement and review phases.

## File format

```json
{
  "sprint": <sprint number>,
  "task": "<the original task, verbatim>",
  "reviewDimensions": [
    { "name": "<dimension name>", "description": "<what this dimension measures, specific to this task>" }
  ],
  "features": [
    {
      "id": "<unique id, must match describe() block name for coding tasks>",
      "name": "<short display name>",
      "prompt": "<describe the intent — WHAT and WHY, not exact steps>",
      "background": "<WHY this feature exists — what problem it solves, what context led to it being split out>",
      "evaluation": {
        "checks": ["<deterministic commands that must pass>"],
        "intent": "<what 'done right' looks like from a user's perspective>"
      },
      "status": "pending"
    }
  ]
}
```

## How to write `reviewDimensions`

Define 3–5 dimensions that the Evaluator will score on (1-5 scale) during the review phase.
Dimensions should be SPECIFIC to this task, not generic. Examples:

- Coding task: `{ "name": "robustness", "description": "Handles malformed inputs without crashing" }`
- Wiki task: `{ "name": "accuracy", "description": "Content matches the source repository's actual code and architecture" }`
- Documentation: `{ "name": "followability", "description": "A new developer can complete every step without external help" }`

## How to write `evaluation`

### `checks` — deterministic commands the orchestrator runs automatically (zero cost)
- Must be valid shell commands that exit 0 on success, non-zero on failure
- For coding tasks: `"cd project && npx vitest run --testNamePattern 'featureId' --reporter verbose"`
- For file checks: `"test -f project/README.md"`, `"grep -q '## API' project/README.md"`

### `intent` — the quality bar (the Evaluator reads this to understand your expectations)
- Describe what "done right" looks like, not what commands to run
- The Evaluator designs its own verification strategy based on this

## How to write `background`
- Explain WHY this feature was split out as a separate unit
- What problem does it solve? What context led to it?
- This helps both the Generator (during implementation) and the Evaluator (during review) understand the motivation
