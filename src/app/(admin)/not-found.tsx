import Link from "next/link";
import { Card, buttonClasses } from "@/components/ui/primitives";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-16">
      <Card className="flex w-full flex-col items-center gap-3 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist or the record may have been deleted.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/" className={buttonClasses("outline")}>Dashboard</Link>
          <Link href="/recommendations" className={buttonClasses()}>Recommendations</Link>
        </div>
      </Card>
    </div>
  );
}
