import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toDTO } from "@/lib/serialize";
import { RecommendationForm } from "@/components/RecommendationForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit recommendation — IndiaCharts Admin" };

export default async function EditRecommendationPage({ params }: { params: { id: string } }) {
  const rec = await prisma.recommendation.findUnique({ where: { id: params.id } });
  if (!rec) notFound();
  return <RecommendationForm initial={toDTO(rec)} />;
}
