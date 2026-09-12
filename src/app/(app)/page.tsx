import type { Metadata } from "next";
import { HomeScreen } from "./home-screen";

export const metadata: Metadata = { title: "Mirror" };

export default function HomePage() {
  return <HomeScreen />;
}
