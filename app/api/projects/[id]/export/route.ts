import { loadProjectExport } from "@/lib/projects";

/** Export data for one project. A GET, so it never waits behind server actions. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await loadProjectExport(id);
    if (!data) {
      return Response.json({ error: "Project not found." }, { status: 404 });
    }
    return Response.json(data);
  } catch (error) {
    console.error("[export] Could not load export data", error);
    return Response.json(
      { error: "Could not prepare the export." },
      { status: 500 },
    );
  }
}
