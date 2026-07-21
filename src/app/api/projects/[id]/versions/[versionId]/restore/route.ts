import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { restoreProjectVersion } from "@/server/project-repository";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const { id, versionId } = await context.params;
    const project = await restoreProjectVersion(id, versionId);

    return project ? apiOk(project) : apiError("NOT_FOUND", "Versionen blev ikke fundet.", 404);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
