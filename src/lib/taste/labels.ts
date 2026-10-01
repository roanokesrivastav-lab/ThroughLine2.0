// Display labels for the Stage 3 recommendation card (handoff §2.5). Client-safe:
// imports types only, so it can be used from components. Placeholder copy — the
// founder may change the wording freely; it never affects scoring or snapshots.
import type { Route } from "@/lib/types";
import type { RerankInfo } from "./snapshot";

export const ROUTE_LABEL: Record<Route, string> = {
  story: "Same kind of story",
  feeling: "Connection in feeling",
  form: "The length you tend to love",
  creator: "Same hands",
  phase: "Your current phase",
  backlog: "From your list",
};

export const BAND_LABEL: Record<RerankInfo["band"], string> = {
  familiar: "Close to what you love",
  adjacent: "A step sideways",
  stretch: "A stretch",
};
