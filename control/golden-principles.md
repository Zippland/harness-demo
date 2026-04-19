# Golden Principles

## Implementation

1. Keep implementations simple and direct. No unnecessary abstractions.
2. Use TypeScript strict types — no `any`, no type assertions unless unavoidable.
3. Handle edge cases: empty strings, empty arrays, boundary values.
4. One function per concern. Do not combine unrelated logic.
5. Prefer built-in language features over third-party libraries.
6. All functions must be named exports from `src/index.ts`.

## Research

7. Understand before you act. Understanding means your model generates correct predictions — "this module exists because X needed to decouple from Y" beats "this module exists".
8. First principles over pattern matching. Decompose the thing in front of you into its fundamental parts; pattern matching fails silently when the thing is non-standard.
9. Depth beats breadth. One file read with the question "why does this exist?" teaches more than ten files read with the question "what is this?"
10. Confusion is signal, not noise. When something doesn't make sense, stop and fix your model. The confusion you skip today becomes the error in your output tomorrow.
11. Research serves execution. If you're reading to feel prepared rather than to answer a specific question, you've crossed from research into avoidance.
