import type { Metadata } from "next";
import { ConnectionsScreen } from "./connections-screen";
export const metadata: Metadata = { title: "Connections" };
export default function ConnectionsPage() { return <ConnectionsScreen />; }
