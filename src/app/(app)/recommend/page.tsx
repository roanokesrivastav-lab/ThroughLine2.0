import type { Metadata } from "next";
import { RecommendScreen } from "./recommend-screen";
export const metadata: Metadata = { title: "Find" };
export default function RecommendPage() { return <RecommendScreen />; }
