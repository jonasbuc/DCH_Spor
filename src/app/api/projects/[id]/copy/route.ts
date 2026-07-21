import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { copyProject } from "@/server/project-repository";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await copyProject(id);
    return project ? apiOk(project, { status: 201 }) : apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
