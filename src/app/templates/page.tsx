import Link from "next/link";
import type { TrackTemplateRules } from "@/domain/types";
import { createDchBTrackTemplate } from "@/domain/rules/templates";
import { db } from "@/server/prisma-minimal";
import { ensureTemplate } from "@/server/project-repository";
import { TemplateAdminForm } from "@/components/templates/template-admin-form";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await ensureTemplate();
  const templates = await db.trackTemplate.findMany({ include: { trackRules: true }, orderBy: { name: "asc" } });

  return (
    <main className="min-h-screen bg-[#f5f7f4] px-5 py-8 text-ink-900">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm text-field-700 underline">
          Tilbage
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Sportemplates</h1>
        <p className="mt-2 text-ink-700">Redigér de konfigurerbare regler for DcH-spor. Nye projekter bruger de gemte templateværdier.</p>
        <div className="mt-6 grid gap-4">
          {templates.map((template) => (
            <TemplateAdminForm
              key={template.id}
              template={{
                id: template.id,
                name: template.name,
                description: template.description,
                rules: parseRules(template.rules)
              }}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function parseRules(value: string): TrackTemplateRules {
  try {
    return JSON.parse(value) as TrackTemplateRules;
  } catch {
    return createDchBTrackTemplate();
  }
}
