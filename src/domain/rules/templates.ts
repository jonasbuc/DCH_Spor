import type { TrackTemplateRules } from "@/domain/types";
import { stepsToMeters } from "@/utils/locale";

export function createDchBTrackTemplate(stepLengthMeters = 0.75): TrackTemplateRules {
  const lengthSteps = 200;
  const minMiddleSegmentSteps = 30;
  const minTrackSpacingSteps = 20;

  return {
    code: "DCH_B",
    name: "DcH B-spor",
    lengthSteps,
    stepLengthMeters,
    lengthMeters: stepsToMeters(lengthSteps, stepLengthMeters),
    turnCount: 2,
    turnAngleDegrees: 90,
    minMiddleSegmentSteps,
    minMiddleSegmentMeters: stepsToMeters(minMiddleSegmentSteps, stepLengthMeters),
    objectCount: 2,
    minTrackSpacingSteps,
    minTrackSpacingMeters: stepsToMeters(minTrackSpacingSteps, stepLengthMeters),
    trackAgeInfo: "ca. 1 time",
    startMarkers: 1,
    objectMaterial: "træ",
    minLastObjectToFinishMeters: 8,
    minObjectDistanceFromTurnMeters: 5,
    angleToleranceDegrees: 2,
    lengthToleranceMeters: 1
  };
}

export function createDchATrackTemplate(stepLengthMeters = 0.75): TrackTemplateRules {
  const lengthSteps = 600;
  const minMiddleSegmentSteps = 30;
  const minTrackSpacingSteps = 30;

  return {
    code: "DCH_A",
    name: "DcH A-spor",
    lengthSteps,
    stepLengthMeters,
    lengthMeters: stepsToMeters(lengthSteps, stepLengthMeters),
    turnCount: 3,
    turnAngleDegrees: 90,
    turnAnglesDegrees: [90, 90, 60],
    minMiddleSegmentSteps,
    minMiddleSegmentMeters: stepsToMeters(minMiddleSegmentSteps, stepLengthMeters),
    objectCount: 3,
    minTrackSpacingSteps,
    minTrackSpacingMeters: stepsToMeters(minTrackSpacingSteps, stepLengthMeters),
    trackAgeInfo: "ca. 1,5 time",
    startMarkers: 2,
    objectMaterial: "forskelligt materiale",
    minLastObjectToFinishMeters: 18.75,
    minObjectDistanceFromTurnMeters: 18.75,
    angleToleranceDegrees: 3,
    lengthToleranceMeters: 1.5
  };
}

export function createDchETrackTemplate(stepLengthMeters = 0.75): TrackTemplateRules {
  const lengthSteps = 1000;
  const minMiddleSegmentSteps = 30;
  const minTrackSpacingSteps = 40;

  return {
    code: "DCH_E",
    name: "DcH E-spor / Elite",
    lengthSteps,
    stepLengthMeters,
    lengthMeters: stepsToMeters(lengthSteps, stepLengthMeters),
    turnCount: 6,
    turnAngleDegrees: 90,
    turnAnglesDegrees: [90, 90, 90, 90, 45, 45],
    minMiddleSegmentSteps,
    minMiddleSegmentMeters: stepsToMeters(minMiddleSegmentSteps, stepLengthMeters),
    objectCount: 4,
    minTrackSpacingSteps,
    minTrackSpacingMeters: stepsToMeters(minTrackSpacingSteps, stepLengthMeters),
    trackAgeInfo: "ca. 2 timer",
    startMarkers: 4,
    objectMaterial: "forskelligt materiale",
    minLastObjectToFinishMeters: 18.75,
    minObjectDistanceFromTurnMeters: 18.75,
    angleToleranceDegrees: 5,
    lengthToleranceMeters: 2
  };
}

export const dchBTrackTemplate = createDchBTrackTemplate();
export const dchATrackTemplate = createDchATrackTemplate();
export const dchETrackTemplate = createDchETrackTemplate();
export const dchTrackTemplates = [dchBTrackTemplate, dchATrackTemplate, dchETrackTemplate];

export function updateStepLength(template: TrackTemplateRules, stepLengthMeters: number): TrackTemplateRules {
  return {
    ...template,
    stepLengthMeters,
    lengthMeters: stepsToMeters(template.lengthSteps, stepLengthMeters),
    minMiddleSegmentMeters: stepsToMeters(template.minMiddleSegmentSteps, stepLengthMeters),
    minTrackSpacingMeters: stepsToMeters(template.minTrackSpacingSteps, stepLengthMeters)
  };
}
