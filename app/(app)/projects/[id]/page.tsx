import Link from "next/link";
import { Suspense } from "react";

function ProjectContent({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/projects"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to projects
      </Link>
      <h1 className="text-2xl font-semibold">Annotation page</h1>
      <p className="text-muted-foreground">
        Project <span className="font-mono text-sm">{id}</span> — coming soon.
      </p>
    </div>
  );
}

async function ProjectPageInner({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectContent id={id} />;
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
      <ProjectPageInner params={params} />
    </Suspense>
  );
}
