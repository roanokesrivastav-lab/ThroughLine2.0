import type { Metadata } from "next";
import { TasteScreen } from "./taste-screen";
export const metadata: Metadata = { title: "Taste" };
export default function TastePage() { return <TasteScreen />; }
