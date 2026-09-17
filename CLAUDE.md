# Throughline — instructions for every AI session

Read `docs/PRD.md` and `docs/STATE.md` before touching code.

- `docs/PRD.md` §8 (reserved seats) and §9 (do not build) are hard boundaries. If a task seems to need one, stop and say so; do not build a small version.
- 🔒 decisions in the PRD can only be reopened by the founder, explicitly, outside a coding session.
- Never show popularity, aggregate scores, or other users' data anywhere by default. External scores are tap-to-reveal only.
- Never modify a user's raw note. Extractions live in `extracted_attributes`, never in `reactions.raw_note`.
- Every new user-writable table gets RLS. The Anthropic key and the Supabase service role key never reach the client.
- Plan before editing files. Explain in plain language; the founder is learning to code.
- Log judgment calls in `docs/DECISIONS.md`. Update `docs/STATE.md` before ending any session that changed code, including failed or interrupted ones, and never mark something phone-verified unless it was opened on a real phone.

Commands: `npm run dev`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.


## vexp - Context-Aware AI Coding <!-- vexp v3.1.3 -->

### Context strategy: call run_pipeline ONCE at task start
If the task already names the files/symbols to touch, SKIP vexp. Otherwise one
`run_pipeline({ "task": "..." })` returns ranked pivot files with line ranges and
blast radius. Do NOT open files one by one to find your way around - every extra
tool call costs a turn. Call it again ONLY when the task moves to a new area.
`get_skeleton` for files to understand, not edit. `verify_done` before calling a
multi-file task complete, then RUN the tests it names.

### Query shape (do this)
Anchor the task on real identifiers (ClassName, functionName) or file paths:
`run_pipeline({ "task": "fix JWT expiry in AuthService.validateToken" })`

vexp runs entirely on this machine, index in `.vexp/`;
`run_pipeline` transmits nothing to any external service.
On `status: "degraded"` or 0 pivots the index is still building - use your own tools.
For literal string sweeps use your native search - do NOT route text sweeps through vexp.
Repo SOURCE only: logs, dist/, node_modules/ and files outside the repo are NOT indexed.
<!-- /vexp -->