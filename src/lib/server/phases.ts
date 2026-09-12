import "server-only";
import type { Db } from "./entries";
import { loadLibrary } from "./entries";
import { detectPhases } from "@/lib/taste/phases";
import type { PhasesRow } from "@/lib/db/types";

/** Re-runs phase detection and reconciles the phases table by fingerprint (keeps user labels and dismissals). */
export async function syncPhases(db: Db, userId: string) {
  const library = await loadLibrary(db, userId);
  const detected = detectPhases(library);
  const { data: existing, error } = await db.from("phases").select("*").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const byFp = new Map((existing ?? []).map((p) => [p.fingerprint, p]));
  const seen = new Set<string>();

  for (const d of detected) {
    seen.add(d.fingerprint);
    const prev = byFp.get(d.fingerprint);
    const payload = {
      user_id: userId, kind: d.kind, fingerprint: d.fingerprint, label: d.label, start_at: d.start_at, end_at: d.end_at,
      category: d.category, confidence: d.confidence, evidence: d.evidence as PhasesRow["evidence"], detected_at: new Date().toISOString(),
    };
    let phaseId = prev?.id;
    if (prev) {
      await db.from("phases").update(payload).eq("id", prev.id);
    } else {
      const { data, error: insErr } = await db.from("phases").insert(payload).select("id").single();
      if (insErr) { console.error("[phases] insert failed:", insErr.message); continue; }
      phaseId = data.id;
    }
    if (!phaseId) continue;
    await db.from("phase_members").delete().eq("phase_id", phaseId);
    const members = d.entryIds.map((entry_id) => ({ phase_id: phaseId!, entry_id, user_id: userId, weight: 1 }));
    if (members.length) await db.from("phase_members").insert(members);
  }
  // Phases that no longer hold (entries deleted/changed) are removed unless the user renamed them.
  const stale = (existing ?? []).filter((p) => !seen.has(p.fingerprint) && !p.user_label).map((p) => p.id);
  if (stale.length) await db.from("phases").delete().in("id", stale);
  return { detected: detected.length, removed: stale.length };
}

export async function loadPhases(db: Db, userId: string) {
  const [{ data: phases, error }, { data: members }] = await Promise.all([
    db.from("phases").select("*").eq("user_id", userId).order("start_at", { ascending: false }),
    db.from("phase_members").select("phase_id, entry_id").eq("user_id", userId),
  ]);
  if (error) throw new Error(error.message);
  const byPhase = new Map<string, string[]>();
  for (const m of members ?? []) byPhase.set(m.phase_id, [...(byPhase.get(m.phase_id) ?? []), m.entry_id]);
  return (phases ?? []).map((p) => ({
    id: p.id, user_id: p.user_id, kind: p.kind, fingerprint: p.fingerprint, label: p.label, user_label: p.user_label,
    start_at: p.start_at, end_at: p.end_at, category: p.category, confidence: Number(p.confidence),
    evidence: (p.evidence ?? {}) as Record<string, unknown>, dismissed: p.dismissed, detected_at: p.detected_at,
    entryIds: byPhase.get(p.id) ?? [],
  }));
}
export type PhaseWithMembers = Awaited<ReturnType<typeof loadPhases>>[number];
