import type { Metadata } from "next";
import { TimelineScreen } from "./timeline-screen";

export const metadata: Metadata = { title: "Timeline" };

export default function TimelinePage() {
  return <TimelineScreen />;
}
