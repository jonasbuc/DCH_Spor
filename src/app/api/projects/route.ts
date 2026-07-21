import { apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { createProject, listProjects } from "@/server/project-repository";
import { createProjectSchema } from "@/server/schemas/project";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return apiOk(await listProjects());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createProjectSchema.parse(await request.json());
    return apiOk(await createProject(input), { status: 201 });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
