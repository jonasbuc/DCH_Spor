import Link from "next/link";
import { CalendarDays, FilePlus2, MapPinned, Ruler, ShieldCheck } from "lucide-react";
import { listProjects } from "@/server/project-repository";
import { formatHectares, formatSquareMeters } from "@/utils/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <main className="min-h-screen bg-[#f5f7f4] text-ink-900">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-field-700">DcH Sporplanlægger</p>
            <h1 className="mt-2 text-3xl font-semibold">Målbar sporplanlægning til DcH B-spor</h1>
            <p className="mt-3 max-w-3xl text-ink-700">
              Tegn marken i meterkoordinater, placér B-spor med 90-graders knæk, validér reglerne og eksportér planen som
              SVG, PNG, PDF, GeoJSON eller projektfil.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/templates">
              <Button icon={<ShieldCheck size={18} />}>Redigér templates</Button>
            </Link>
            <Link href="/projects/new">
              <Button variant="primary" icon={<FilePlus2 size={18} />}>
                Opret projekt
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-4 px-5 py-6 md:grid-cols-4">
        {[
          ["Kort og billede", "Tegn polygoner oven på markdata.", MapPinned],
          ["Danske mål", "28.310 m² vises som 2,831 ha.", Ruler],
          ["Regeltemplates", "DcH B-spor er konfigurerbart.", ShieldCheck],
          ["Gem og genåbn", "Projekter autosaves i SQLite lokalt.", CalendarDays]
        ].map(([title, body, Icon]) => (
          <div key={title as string} className="rounded-md border border-slate-200 bg-white p-4 shadow-panel">
            <Icon className="mb-3 text-field-700" size={20} />
            <h2 className="font-semibold">{title as string}</h2>
            <p className="mt-1 text-sm text-ink-500">{body as string}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Projekter</h2>
          <Badge tone="neutral">{projects.length} projekter</Badge>
        </div>
        <div className="grid gap-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-panel transition hover:border-field-600 md:grid-cols-[1fr_auto]"
            >
              <div>
                <h3 className="font-semibold">{project.name}</h3>
                <p className="mt-1 text-sm text-ink-500">
                  {project.club || "Ingen klub"} · {project.tracks.length} spor · {formatSquareMeters(project.field.areaM2)} ·{" "}
                  {formatHectares(project.field.areaM2)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={project.tracks.length >= project.requestedTrackCount ? "ok" : "warning"}>
                  {project.tracks.length}/{project.requestedTrackCount} spor
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
