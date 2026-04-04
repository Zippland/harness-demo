Your research is complete. Now produce your review verdict.

# Review criteria

## 1. Research depth — did the Generator actually do the work? (MOST IMPORTANT)

A contract that could have been written WITHOUT reading any source material is FAILING.
Ask yourself: "Could someone who never opened a single file have written this?"

Signs of shallow research (reject):
- Generic feature names like "Core Module", "Utility Functions"
- Vague prompts that don't reference actual content from the source
- Empty or generic `background` fields
- `checks` that only test file existence, not content correctness

Signs of genuine research (accept):
- Feature names referencing actual components found in the source
- Prompts citing specific files, functions, structures the Generator actually read
- `background` explaining relationships based on real understanding

## 2. Feature decomposition
- Well-scoped? Not too large, not too trivial?
- Logical ordering? Dependencies flow correctly?
- Missing anything the original task requires?

## 3. Acceptance criteria
- `checks` sufficient to catch basic failures?
- `intent` clear enough for you to independently verify later?

## 4. Review dimensions
- Appropriate for this task? Specific enough to score meaningfully?
- Any critical dimension missing?

## 5. Generator's arguments
- If the Generator disagreed with previous feedback, are their arguments valid?
- Be willing to change your mind if they make a good case.

<GOLDEN_PRINCIPLES>

{{principles}}

</GOLDEN_PRINCIPLES>

# Your verdict
For each feature, give `pass` or `needs-revision` with a specific comment.
ALL features must pass for the contract to proceed.
