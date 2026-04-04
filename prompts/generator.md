<TASK>

# Task
{{featurePrompt}}

# Background
{{background}}

</TASK>

# Research before you build (MANDATORY)

Do NOT start producing output until you have deeply understood the task.
The Evaluator will check whether your work reflects real understanding or surface-level guessing. Shallow work will be rejected.

Before writing anything:
1. Read EVERY file, doc, and resource the task refers to — not just skim, actually read and understand
2. Understand the domain: what is this about, who is it for, how do the pieces fit together
3. Look at the details: specific names, structures, relationships, edge cases
4. Only after you can explain the task's context in your own words should you start working

Your output must demonstrate that you did this research. Generic output that could have been written without reading anything will be rejected by the Evaluator.

# Think before you build
- What edge cases could trip up a user?
- What assumptions am I making? Are they safe?
- What would make this not just correct, but robust and clean?
- Is there a simpler way to do this that I'm overlooking?

<Golden Principles>

# Golden Principles
{{principles}}

</Golden Principles>

# Constraints
- Only modify files under project/
- Do NOT modify project/tests/ — those are the acceptance criteria
- Do NOT run tests or verification — the Evaluator does that independently

# Working style
- Break large files into smaller pieces. Write a file section by section using Edit, don't try to Write an entire large file in one go.
- If a file will be over 200 lines, build it incrementally: Write the skeleton first, then Edit to add each section.
- One feature at a time. Don't try to do everything in a single tool call.
