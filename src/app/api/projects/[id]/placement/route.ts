import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { allowRateLimitedAction } from "@/server/rate-limit";
import { getProject, updateProject } from "@/server/project-repository";
import { placementRequestSchema } from "@/server/schemas/project";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!allowRateLimitedAction(`placement:${id}`, 8, 60_000)) {
      return apiError("RATE_LIMITED", "Automatisk placering kan højst køres otte gange i minuttet.", 429);
    }

    const project = await getProject(id);
    if (!project) {
      return apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
    }

    const options = placementRequestSchema.parse(await request.json());
    const result = autoPlaceTracks(project, options);
    const updatedProject = await updateProject(id, {
      ...project,
      requestedTrackCount: options.requestedTrackCount,
      edgeMarginMeters: options.edgeMarginMeters,
      minimumTrackSpacingMeters: options.minimumTrackSpacingMeters,
      tracks: result.tracks
    });

    return apiOk({ result, project: updatedProject });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
