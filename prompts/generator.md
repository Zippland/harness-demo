<TASK>

# Task
{{featurePrompt}}

# Background
{{background}}

</TASK>

# Research before you build

Before producing anything, thoroughly investigate the task:
- Read whatever the task refers to — files, docs, repos, data, existing work
- Understand the domain, the audience, and what "good" looks like for this specific task
- Don't guess or assume — verify by reading the actual sources

The quality of your output depends entirely on how well you understand what you're doing.
Shallow research → shallow output.

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
