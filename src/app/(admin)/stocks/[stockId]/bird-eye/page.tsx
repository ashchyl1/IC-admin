import { BirdEyeView } from "@/components/BirdEyeView";

export const metadata = { title: "Bird's Eye View — IndiaCharts Admin" };

export default function BirdEyePage({ params }: { params: { stockId: string } }) {
  return <BirdEyeView stockId={decodeURIComponent(params.stockId)} />;
}
