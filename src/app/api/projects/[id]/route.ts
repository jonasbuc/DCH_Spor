import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { deleteProject, getProject, updateProject } from "@/server/project-repository";
import { updateProjectSchema } from "@/server/schemas/project";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);
    return project ? apiOk(project) : apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = updateProjectSchema.parse(await request.json());
    const project = await updateProject(id, input.snapshot);
    return project ? apiOk(project) : apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deleted = await deleteProject(id);
    return deleted ? apiOk({ deleted: true }) : apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
