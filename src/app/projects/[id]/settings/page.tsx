import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/server/project-repository";
import { db } from "@/server/prisma-minimal";
import { formatMeters } from "@/utils/locale";
import { VersionRestorePanel } from "@/components/projects/version-restore-panel";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  const versions = await db.projectVersion.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-5 py-8 text-ink-900">
      <div className="mx-auto max-w-4xl">
        <Link href={`/projects/${project.id}`} className="text-sm text-field-700 underline">
          Tilbage til editoren
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Projekt- og regelindstillinger</h1>
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <h2 className="font-semibold">Projekt</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt>Klub</dt>
                <dd>{project.club || "-"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Ønsket sporantal</dt>
                <dd>{project.requestedTrackCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Kantmargin</dt>
                <dd>{formatMeters(project.edgeMarginMeters, 0)}</dd>
              </div>
            </dl>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <h2 className="font-semibold">{project.template.name}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt>Længde</dt>
                <dd>
                  {project.template.lengthSteps} skridt / {formatMeters(project.template.lengthMeters)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Knæk</dt>
                <dd>{project.template.turnCount} x {project.template.turnAngleDegrees}°</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Minimum mellem knæk</dt>
                <dd>{formatMeters(project.template.minMiddleSegmentMeters)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Minimumafstand mellem spor</dt>
                <dd>{formatMeters(project.template.minTrackSpacingMeters)}</dd>
              </div>
            </dl>
          </div>
        </section>
        <VersionRestorePanel
          projectId={project.id}
          versions={versions.map((version) => ({
            id: version.id,
            label: version.label,
            createdAt: version.createdAt.toISOString()
          }))}
        />
      </div>
    </main>
  );
}
