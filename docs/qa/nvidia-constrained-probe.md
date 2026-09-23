# NVIDIA constrained-output probe (Amendment 1 §C)

Date: 2026-09-23 · model: nvidia/nemotron-3-super-120b-a12b · session calls used (ledger total): 59

Fixed inputs: profile = movie-spirited-away (canon catalogue data only); reading = the movie-in-the-mood-for-love demo seed note.
One attempt per call, no retries; a variant stops the sweep only when BOTH paths validate strictly.

| Variant | Request accepted | HTTP status | Profile validates | Reading validates | Latency (profile / reading) |
|---|---|---|---|---|---|
| response_format json_schema (thinking on) | profile: n/a (server error), reading: n/a (server error) | — / — | ❌ HTTP ? — [
  {
    "code": "unrecognized_keys",
    "keys": [
      "moral-complexity",
  | ❌ HTTP ? — [
  {
    "code": "invalid_value",
    "values": [
      "spare",
      "dense", | 25268 / 76097 ms |
| guided_json (thinking on) | profile: n/a (server error), reading: n/a (server error) | 503 / — | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service | ❌ HTTP ? — [
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
       | 347 / 44107 ms |
| response_format json_schema (thinking off) | profile: n/a (server error), reading: n/a (server error) | 503 / 503 | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service | 219 / 198 ms |
| guided_json (thinking off) | profile: n/a (server error), reading: n/a (server error) | 503 / 503 | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service | ❌ HTTP 503 — NVIDIA API 503 (nvidia/nemotron-3-super-120b-a12b): {"error":{"message":"Service | 257 / 151 ms |

**No variant validated. NVIDIA_JSON_MODE stays `none`; keep the §B prompt changes and STOP (founder decides on switching models).**

Every call went through CallLedger (scripts/out/calls.jsonl) and counts against the 500-call cap.
