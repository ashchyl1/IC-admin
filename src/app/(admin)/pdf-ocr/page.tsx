import { PdfOcrWorkspace } from "@/components/pdf-ocr/PdfOcrWorkspace";
import { fetchServiceStatus } from "@/lib/pdf-ocr/service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "PDF to text",
  description: "Convert a PDF into plain text with Unlimited-OCR",
};

export default async function PdfOcrPage() {
  // Fetched on the server so the page already knows whether the OCR service is
  // up -- no flash of a working form that cannot actually submit.
  const status = await fetchServiceStatus();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PDF to text</h1>
        <p className="text-sm text-muted-foreground">
          Upload a PDF and read it with{" "}
          <a
            href="https://github.com/baidu/Unlimited-OCR"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Unlimited-OCR
          </a>
          . Works on scanned pages, not just PDFs that already carry a text layer.
        </p>
      </div>
      <PdfOcrWorkspace initialStatus={status} />
    </div>
  );
}
