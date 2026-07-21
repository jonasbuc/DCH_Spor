import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { getProject } from "@/server/project-repository";
import { db } from "@/server/prisma-minimal";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);

    if (!project) {
      return apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
    }

    const versions = await db.projectVersion.findMany({
      where: { projectId: id },
      orderBy: { createdAt: "desc" }
    });

    return apiOk(versions);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);

    if (!project) {
      return apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
    }

    const version = await db.projectVersion.create({
      data: {
        projectId: id,
        label: `Snapshot ${project.version}`,
        snapshot: JSON.stringify(project)
      }
    });

    return apiOk(version, { status: 201 });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
