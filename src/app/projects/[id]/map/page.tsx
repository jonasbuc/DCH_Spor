import { notFound } from "next/navigation";
import { MapWorkflow } from "@/components/map/map-workflow";
import { getProject } from "@/server/project-repository";

export const dynamic = "force-dynamic";

export default async function ProjectMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  return <MapWorkflow initialProject={project} />;
}
