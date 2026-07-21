import { validateProject } from "@/domain/validation/validation";
import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { getProject } from "@/server/project-repository";
import { db } from "@/server/prisma-minimal";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);

    if (!project) {
      return apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
    }

    const result = validateProject(project);
    await db.validationSnapshot.create({
      data: {
        projectId: id,
        result: JSON.stringify(result)
      }
    });

    return apiOk(result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
