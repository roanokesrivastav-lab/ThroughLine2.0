# NVIDIA constrained-output probe (Amendment 1 §C)

Date: 2026-09-23 · model: nvidia/nemotron-3-super-120b-a12b · session calls used (ledger total): 66

Fixed inputs: profile = movie-spirited-away (canon catalogue data only); reading = the movie-in-the-mood-for-love demo seed note.
One attempt per call, no retries except a single 503 retry (a 503 says nothing about the variant); 5 s pacing between calls.
A variant stops the sweep only when BOTH paths validate strictly.

Re-probe note: the first probe (same date, 8 calls) measured nothing — the adapter read the mode/thinking env vars once at import, so every call ran unconstrained, and the §B worked examples showed scalars inside story/feeling. Both fixed before this run; calls count against the same ledger. Whole-run invocations were also destroyed twice by the session harness (background reaping / command timeout, zero calls lost thanks to per-attempt ledger lines), so the sweep now runs one variant per invocation.

| Variant | Request accepted | HTTP status | Profile validates | Reading validates | Latency (profile / reading) |
|---|---|---|---|---|---|
| response_format json_schema (thinking on) | profile: yes, reading: n/a (server error) | — / 503 | ✅ (22486 ms) | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service temporari | 22486 / 346 ms |
| guided_json (thinking on) | profile: no, reading: no | 400 / 400 | ❌ HTTP 400 — NVIDIA API 400 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"unknown field `gu | ❌ HTTP 400 — NVIDIA API 400 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"unknown field `gu | 474 / 461 ms |
| response_format json_schema (thinking off) | profile: yes, reading: yes | — / — | ✅ (10663 ms) | ✅ (11059 ms) | 10663 / 11059 ms |

**Winner: `response_format` with thinking disabled.** Set `NVIDIA_JSON_MODE=response_format` and `NVIDIA_DISABLE_THINKING=1` in `.env.local`.

Probe calls: 6 content calls + 1 503 retry (amendment cap 8 content calls) · every call went through CallLedger (scripts/out/calls.jsonl) and counts against the 500-call cap.
