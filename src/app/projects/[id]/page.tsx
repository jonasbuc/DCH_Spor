import { notFound } from "next/navigation";
import { EditorShell } from "@/components/editor/editor-shell";
import { getProject } from "@/server/project-repository";

export const dynamic = "force-dynamic";

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  return <EditorShell initialProject={project} />;
}
