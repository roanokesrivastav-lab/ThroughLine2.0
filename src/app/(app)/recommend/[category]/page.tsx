import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecommendScreen } from "../recommend-screen";
import { CATEGORIES, type Category } from "@/lib/types";
export const metadata: Metadata = { title: "Find" };
export default async function RecommendCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!CATEGORIES.includes(category as Category)) notFound();
  return <RecommendScreen category={category as Category} />;
}
