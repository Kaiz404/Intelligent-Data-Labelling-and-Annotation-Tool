import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

async function ProjectsList() {
  await connection();
  const supabase = await createClient();
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return <p className="text-sm text-red-500">Failed to load projects.</p>;
  }

  if (!projects?.length) {
    return <p className="text-sm text-muted-foreground">No projects yet.</p>;
  }

  return (
    <ul className="divide-y rounded-lg border">
      {projects.map((project) => (
        <li key={project.id}>
          <Link
            href={`/projects/${project.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-accent/50"
          >
            <span className="font-medium">{project.name}</span>
            <span className="text-sm text-muted-foreground">
              {project.created_at
                ? new Date(project.created_at).toLocaleDateString()
                : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-muted-foreground">Your annotation projects</p>
      </div>

      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <ProjectsList />
      </Suspense>
    </div>
  );
}
