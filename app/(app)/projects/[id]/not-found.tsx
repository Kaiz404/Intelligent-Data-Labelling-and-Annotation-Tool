import Link from "next/link";
import { AppHeader } from "@/components/app-shell/app-header";
import { Button } from "@/components/ui/button";

export default function ProjectNotFound() {
  return (
    <>
      <AppHeader />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-2xl font-semibold">Project not found</h1>
        <p className="text-muted-foreground">
          This project may have been deleted or you do not have access.
        </p>
        <Button asChild>
          <Link href="/projects">Back to projects</Link>
        </Button>
      </div>
    </>
  );
}
