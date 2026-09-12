import type { Metadata } from "next";
import { OnboardingScreen } from "./onboarding-screen";

export const metadata: Metadata = { title: "Begin" };

export default function OnboardingPage() {
  return <OnboardingScreen />;
}
