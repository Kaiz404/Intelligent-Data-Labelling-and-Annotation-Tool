import { revalidatePath } from "next/cache";
import {
  errorResponse,
  requireOwnedProject,
  uploadProjectThumbnail,
} from "@/lib/uploads/s3-server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await requireOwnedProject(id);
    const formData = await request.formData();
    const file = formData.get("thumbnail");
    if (!(file instanceof File)) {
      return Response.json(
        { error: "Choose a thumbnail image." },
        { status: 400 },
      );
    }

    const thumbnailUrl = await uploadProjectThumbnail(id, file);
    revalidatePath("/dashboard");
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return Response.json({ thumbnailUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
