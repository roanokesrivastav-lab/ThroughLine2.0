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
