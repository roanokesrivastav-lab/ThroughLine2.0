import type { Metadata } from "next";
import { EntryScreen } from "./entry-screen";

export const metadata: Metadata = { title: "Entry" };

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EntryScreen id={id} />;
}
