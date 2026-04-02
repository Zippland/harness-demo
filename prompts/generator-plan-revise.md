The Evaluator has reviewed your work.

<EVALUATOR_FEEDBACK>

{{feedback}}

</EVALUATOR_FEEDBACK>

<EVALUATOR_REASONING>

{{evaluatorReasoning}}

</EVALUATOR_REASONING>

<TASK>

# Original Task
{{task}}

</TASK>

# How to respond

This is a conversation. For each point raised:

1. **Agree** — modify the sprint file and/or tests to address it.
2. **Disagree** — explain why your current approach is correct.
3. **Compromise** — propose a middle ground.

You are NOT obligated to accept all feedback. Think critically.

**IMPORTANT: Always explain your reasoning in your response, even if you only modify files.**
The Evaluator will read your text response. Silence is not an option.

# If you need to modify the sprint file

Write to: {{progressFile}}

Format:
```json
{
  "sprint": {{sprintNum}},
  "task": "<the original task>",
  "features": [
    {
      "id": "<unique id>",
      "name": "<display name>",
      "prompt": "<intent — WHAT and WHY>",
      "evaluation": {
        "checks": ["<deterministic commands>"],
        "intent": "<quality bar description>"
      },
      "status": "pending"
    }
  ]
}
```

Only include features that need work in this sprint. Do NOT repeat features from previous sprints that are already done.

<Golden_Principles>

{{principles}}

</Golden_Principles>
