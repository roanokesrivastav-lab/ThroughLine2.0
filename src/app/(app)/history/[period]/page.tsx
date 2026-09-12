import type { Metadata } from "next";
import { PeriodScreen } from "./period-screen";

export const metadata: Metadata = { title: "Era" };

export default async function PeriodPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  return <PeriodScreen period={period} />;
}
