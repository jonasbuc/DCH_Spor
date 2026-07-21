import type { ProjectSnapshot, TrackTemplateRules } from "@/domain/types";
import { createDemoProject } from "@/domain/demo-data";
import { createDchBTrackTemplate } from "@/domain/rules/templates";
import { calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import { parseAreaInputToM2, squareMetersToHectares } from "@/utils/locale";
import { db } from "@/server/prisma-minimal";
import { getCurrentUserId } from "@/server/auth";

export async function ensureTemplate(): Promise<string> {
  const template = createDchBTrackTemplate();
  const existing = await db.trackTemplate.findFirst({
    where: { code: template.code },
    include: { trackRules: true }
  });

  if (existing) {
    return existing.id;
  }

  const record = await db.trackTemplate.upsert({
    where: { code: template.code },
    update: {},
    create: {
      code: template.code,
      name: template.name,
      description: "Standardtemplate til DcH B-spor.",
      rules: toJson(template)
    }
  });

  const rules = [
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

  for (const trackRule of rules) {
    await db.trackRule.upsert({
      where: { templateId_key: { templateId: record.id, key: trackRule.key } },
      update: trackRule,
      create: { ...trackRule, templateId: record.id }
    });
  }

  return record.id;
}

export async function ensureDemoProject(): Promise<ProjectSnapshot> {
  const ownerId = await getCurrentUserId();
  const existing = await db.project.findFirst({
    where: { ownerId, name: "Eksempelmark - 6 B-spor" }
  });

  if (existing) {
    return fromSnapshotJson(existing.snapshot);
  }

  await ensureTemplate();
  const snapshot = createDemoProject();
  const project = await db.project.create({
    data: {
      ownerId,
      name: snapshot.name,
      club: snapshot.club,
      eventName: snapshot.eventName,
      eventDate: snapshot.eventDate ? new Date(snapshot.eventDate) : undefined,
      description: snapshot.description,
      notes: snapshot.notes,
      requestedTrackCount: snapshot.requestedTrackCount,
      edgeMarginMeters: snapshot.edgeMarginMeters,
      minimumTrackSpacingMeters: snapshot.minimumTrackSpacingMeters,
      snapshot: toJson({ ...snapshot, id: "pending" })
    }
  });

  const updatedSnapshot = { ...snapshot, id: project.id };
  await db.project.update({
    where: { id: project.id },
    data: { snapshot: toJson(updatedSnapshot) }
  });

  return updatedSnapshot;
}

export async function getDefaultTemplateRules(): Promise<TrackTemplateRules> {
  await ensureTemplate();
  const template = createDchBTrackTemplate();
  const record = await db.trackTemplate.findFirst({
    where: { code: template.code },
    include: { trackRules: true }
  });

  if (!record) {
    return template;
  }

  return JSON.parse(record.rules) as TrackTemplateRules;
}

export async function listProjects(): Promise<ProjectSnapshot[]> {
  await ensureDemoProject();
  const ownerId = await getCurrentUserId();
  const projects = await db.project.findMany({
    where: { ownerId },
    orderBy: { updatedAt: "desc" }
  });

  return projects.map((project) => fromSnapshotJson(project.snapshot));
}

export async function getProject(id: string): Promise<ProjectSnapshot | null> {
  const ownerId = await getCurrentUserId();
  const project = await db.project.findFirst({ where: { id, ownerId } });
  return project ? fromSnapshotJson(project.snapshot) : null;
}

export async function createProject(input: { name: string; club?: string; eventName?: string; areaInput?: string }): Promise<ProjectSnapshot> {
  const ownerId = await getCurrentUserId();
  const templateRules = await getDefaultTemplateRules();
  const areaM2 = input.areaInput ? parseAreaInputToM2(input.areaInput) : 28_310;
  const width = Math.sqrt(areaM2 * 4.5);
  const height = areaM2 / width;
  const polygon = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];
  const now = new Date().toISOString();
  const placeholder = createDemoProject("pending");
  const snapshot: ProjectSnapshot = {
    ...placeholder,
    id: "pending",
    name: input.name,
    club: input.club ?? "",
    eventName: input.eventName ?? "",
    description: "",
    notes: "",
    requestedTrackCount: 6,
    field: {
      id: "field-pending",
      name: "Ny mark",
      sourceType: "image",
      areaM2: calculatePolygonArea(polygon),
      areaHa: squareMetersToHectares(calculatePolygonArea(polygon)),
      polygon,
      perimeterMeters: calculatePolygonPerimeter(polygon),
      calibration: {
        method: "area",
        meterPerPixel: 1,
        knownAreaM2: areaM2,
        calculatedAreaM2: areaM2,
        deviationPercent: 0,
        warningDa:
          "Arealbaseret kalibrering er kun præcis, hvis billedet har ens målestok i begge retninger og ikke er perspektivforvrænget."
      }
    },
    restrictedAreas: [],
    tracks: [],
    template: templateRules,
    createdAt: now,
    updatedAt: now
  };

  const project = await db.project.create({
    data: {
      ownerId,
      name: snapshot.name,
      club: snapshot.club,
      eventName: snapshot.eventName,
      description: snapshot.description,
      requestedTrackCount: snapshot.requestedTrackCount,
      edgeMarginMeters: snapshot.edgeMarginMeters,
      minimumTrackSpacingMeters: snapshot.minimumTrackSpacingMeters,
      snapshot: toJson(snapshot)
    }
  });

  const created = { ...snapshot, id: project.id, field: { ...snapshot.field, id: `field-${project.id}` } };
  await db.project.update({
    where: { id: project.id },
    data: { snapshot: toJson(created) }
  });

  await db.projectVersion.create({
    data: {
      projectId: project.id,
      label: "Oprettet",
      snapshot: toJson(created)
    }
  });

  return created;
}

export async function updateProject(id: string, snapshot: ProjectSnapshot): Promise<ProjectSnapshot | null> {
  const ownerId = await getCurrentUserId();
  const existing = await db.project.findFirst({ where: { id, ownerId } });

  if (!existing) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  const nextSnapshot: ProjectSnapshot = {
    ...snapshot,
    id,
    version: snapshot.version + 1,
    updatedAt
  };

  await db.project.update({
    where: { id },
    data: {
      name: nextSnapshot.name,
      club: nextSnapshot.club,
      eventName: nextSnapshot.eventName,
      description: nextSnapshot.description,
      notes: nextSnapshot.notes,
      requestedTrackCount: nextSnapshot.requestedTrackCount,
      edgeMarginMeters: nextSnapshot.edgeMarginMeters,
      minimumTrackSpacingMeters: nextSnapshot.minimumTrackSpacingMeters,
      snapshot: toJson(nextSnapshot)
    }
  });

  return nextSnapshot;
}

export async function deleteProject(id: string): Promise<boolean> {
  const ownerId = await getCurrentUserId();
  const existing = await db.project.findFirst({ where: { id, ownerId } });

  if (!existing) {
    return false;
  }

  await db.project.delete({ where: { id } });
  return true;
}

export async function copyProject(id: string): Promise<ProjectSnapshot | null> {
  const source = await getProject(id);

  if (!source) {
    return null;
  }

  const ownerId = await getCurrentUserId();
  const now = new Date().toISOString();
  const copySnapshot = {
    ...source,
    id: "pending",
    name: `${source.name} (kopi)`,
    createdAt: now,
    updatedAt: now,
    version: 1
  };

  const project = await db.project.create({
    data: {
      ownerId,
      name: copySnapshot.name,
      club: copySnapshot.club,
      eventName: copySnapshot.eventName,
      description: copySnapshot.description,
      notes: copySnapshot.notes,
      requestedTrackCount: copySnapshot.requestedTrackCount,
      edgeMarginMeters: copySnapshot.edgeMarginMeters,
      minimumTrackSpacingMeters: copySnapshot.minimumTrackSpacingMeters,
      snapshot: toJson(copySnapshot)
    }
  });

  const savedSnapshot = { ...copySnapshot, id: project.id };
  await db.project.update({
    where: { id: project.id },
    data: { snapshot: toJson(savedSnapshot) }
  });

  return savedSnapshot;
}

export async function restoreProjectVersion(projectId: string, versionId: string): Promise<ProjectSnapshot | null> {
  const ownerId = await getCurrentUserId();
  const project = await db.project.findFirst({ where: { id: projectId, ownerId } });

  if (!project) {
    return null;
  }

  const version = await db.projectVersion.findFirst({
    where: {
      id: versionId,
      projectId
    }
  });

  if (!version) {
    return null;
  }

  const current = fromSnapshotJson(project.snapshot);
  const restored = fromSnapshotJson(version.snapshot);
  const now = new Date().toISOString();
  const nextSnapshot: ProjectSnapshot = {
    ...restored,
    id: projectId,
    version: current.version + 1,
    updatedAt: now
  };

  await db.project.update({
    where: { id: projectId },
    data: {
      name: nextSnapshot.name,
      club: nextSnapshot.club,
      eventName: nextSnapshot.eventName,
      description: nextSnapshot.description,
      notes: nextSnapshot.notes,
      requestedTrackCount: nextSnapshot.requestedTrackCount,
      edgeMarginMeters: nextSnapshot.edgeMarginMeters,
      minimumTrackSpacingMeters: nextSnapshot.minimumTrackSpacingMeters,
      snapshot: toJson(nextSnapshot)
    }
  });

  await db.projectVersion.create({
    data: {
      projectId,
      label: `Gendannet fra ${version.label}`,
      snapshot: toJson(nextSnapshot)
    }
  });

  return nextSnapshot;
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function fromSnapshotJson(value: string): ProjectSnapshot {
  return JSON.parse(value) as ProjectSnapshot;
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
