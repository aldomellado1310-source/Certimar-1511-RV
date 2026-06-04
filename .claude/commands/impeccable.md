Review every changed file in the current branch diff against main (or against HEAD if no base branch). For each file:

1. **Bugs & correctness** — silent failures, wrong conditions, missing awaits, unhandled edge cases, state inconsistencies.
2. **Security** — XSS, injection, exposed secrets, overly permissive rules.
3. **Simplification** — dead code, duplicated logic, unnecessary complexity, better native alternatives.
4. **Consistency** — naming, patterns and conventions already used in the rest of the codebase.

Apply every fix you are confident about directly to the files.  
Skip anything speculative or that would require a significant refactor — note those as comments at the end.

After applying fixes, output a compact summary:
- **Fixed** — bullet list of what was changed and why (one line each).
- **Noted (not changed)** — bullet list of findings that were left for the developer to decide.

Do not reformat code for style alone. Do not add comments unless the WHY is genuinely non-obvious.
