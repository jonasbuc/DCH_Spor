import type { TrackTemplateRules } from "@/domain/types";
import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";
import { db } from "@/server/prisma-minimal";
import { updateTemplateSchema } from "@/server/schemas/project";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = updateTemplateSchema.parse(await request.json());
    const template = await db.trackTemplate.findFirst({ where: { id }, include: { trackRules: true } });

    if (!template) {
      return apiError("NOT_FOUND", "Templaten blev ikke fundet.", 404);
    }

    const updated = await db.trackTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description ?? "",
        rules: JSON.stringify(input.rules)
      },
      include: { trackRules: true }
    });

    for (const trackRule of rulesToRows(input.rules)) {
      await db.trackRule.upsert({
        where: { templateId_key: { templateId: id, key: trackRule.key } },
        update: trackRule,
        create: { ...trackRule, templateId: id }
      });
    }

    return apiOk(updated);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

function rulesToRows(template: TrackTemplateRules) {
  return [
    rule("lengthSteps", "Længde", template.lengthSteps, "skridt"),
    rule("stepLengthMeters", "Skridtlængde", template.stepLengthMeters, "m"),
    rule("turnCount", "Antal knæk", template.turnCount, "knæk"),
    rule("turnAngleDegrees", "Knækvinkel", template.turnAngleDegrees, "grader"),
    rule("minMiddleSegmentMeters", "Minimum mellem knæk", template.minMiddleSegmentMeters, "m"),
    rule("minTrackSpacingMeters", "Minimumafstand mellem spor", template.minTrackSpacingMeters, "m"),
    rule("objectCount", "Antal genstande", template.objectCount, "genstande"),
    rule("trackAgeInfo", "Sporalder", undefined, "", template.trackAgeInfo),
    rule("objectMaterial", "Genstandstype", undefined, "", template.objectMaterial)
  ];
}

function rule(key: string, labelDa: string, valueNumber?: number, unit = "", valueText?: string) {
  return {
    key,
    labelDa,
    valueNumber,
    valueText,
    unit,
    editable: true
  };
}
