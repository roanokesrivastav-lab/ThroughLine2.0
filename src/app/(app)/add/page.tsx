import type { Metadata } from "next";
import { AddScreen } from "./add-screen";

export const metadata: Metadata = { title: "Add" };

export default function AddPage() {
  return <AddScreen />;
}
