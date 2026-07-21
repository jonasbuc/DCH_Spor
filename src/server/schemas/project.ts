import { z } from "zod";
import type { ProjectSnapshot, TrackTemplateRules } from "@/domain/types";

export const projectSnapshotSchema: z.ZodType<ProjectSnapshot> = z.custom<ProjectSnapshot>((value) => {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (!isRecord(value.field) || !Array.isArray(value.field.polygon)) return false;
  if (!isRecord(value.template) || typeof value.template.code !== "string") return false;
  if (!Array.isArray(value.tracks) || !Array.isArray(value.restrictedAreas)) return false;
  return true;
}, "Projektformatet er ugyldigt.");

export const createProjectSchema = z.object({
  name: z.string().min(1),
  club: z.string().optional(),
  eventName: z.string().optional(),
  areaInput: z.string().optional()
});

export const updateProjectSchema = z.object({
  snapshot: projectSnapshotSchema
});

export const placementRequestSchema = z.object({
  requestedTrackCount: z.number().int().positive().max(1000),
  edgeMarginMeters: z.number().nonnegative().max(100),
  minimumTrackSpacingMeters: z.number().nonnegative().max(100),
  preferredDirectionDegrees: z.number().finite(),
  allowMirror: z.boolean(),
  alternateStartDirections: z.boolean(),
  placeInRows: z.boolean(),
  sameShape: z.boolean(),
  varySegmentLengths: z.boolean(),
  seed: z.number().int()
});

export const trackTemplateRulesSchema: z.ZodType<TrackTemplateRules> = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  lengthSteps: z.number().positive(),
  stepLengthMeters: z.number().positive(),
  lengthMeters: z.number().positive(),
  turnCount: z.number().int().nonnegative(),
  turnAngleDegrees: z.number().positive(),
  minMiddleSegmentSteps: z.number().nonnegative(),
  minMiddleSegmentMeters: z.number().nonnegative(),
  objectCount: z.number().int().nonnegative(),
  minTrackSpacingSteps: z.number().nonnegative(),
  minTrackSpacingMeters: z.number().nonnegative(),
  trackAgeInfo: z.string(),
  startMarkers: z.number().int().nonnegative(),
  objectMaterial: z.string(),
  minLastObjectToFinishMeters: z.number().nonnegative(),
  minObjectDistanceFromTurnMeters: z.number().nonnegative(),
  angleToleranceDegrees: z.number().nonnegative(),
  lengthToleranceMeters: z.number().nonnegative()
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  rules: trackTemplateRulesSchema
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
