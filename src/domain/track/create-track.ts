import type { Coordinate, Track, TrackCandidateShape, TrackTemplateRules, TurnDirection } from "@/domain/types";
import { dchBTrackTemplate } from "@/domain/rules/templates";
import { coordinateAtDistance } from "@/geometry/polylines";
import { metersToSteps } from "@/utils/locale";

const trackColors = ["#1f78b4", "#e8590c", "#2b8a3e", "#9c36b5", "#0b7285", "#c92a2a", "#5f3dc4"];

export function createBTrack(
  id: string,
  displayNo: number,
  start: Coordinate,
  headingDegrees: number,
  shape: TrackCandidateShape = {
    firstTurn: "left",
    secondTurn: "left",
    segmentLengthsMeters: [63.75, 22.5, 63.75]
  }
): Track {
  const points = createTrackPoints(start, headingDegrees, shape);
  const template = dchBTrackTemplate;

  return {
    id,
    displayNo,
    name: `Spor ${displayNo}`,
    templateCode: template.code,
    trackType: "B",
    color: trackColors[(displayNo - 1) % trackColors.length],
    points,
    lengthSteps: template.lengthSteps,
    stepLengthMeters: template.stepLengthMeters,
    lengthMeters: template.lengthMeters,
    rotationDegrees: headingDegrees,
    lockedLength: true,
    lockedAngles: true,
    objects: [
      {
        id: `${id}-object-1`,
        displayNo: 1,
        distanceAlongTrackMeters: 62.5,
        material: template.objectMaterial,
        description: "Genstand 1"
      },
      {
        id: `${id}-object-2`,
        displayNo: 2,
        distanceAlongTrackMeters: template.lengthMeters,
        material: template.objectMaterial,
        description: "Afslutningsgenstand",
        marksFinish: true
      }
    ]
  };
}

export function createTrackFromShape(
  id: string,
  displayNo: number,
  start: Coordinate,
  headingDegrees: number,
  template: TrackTemplateRules,
  shape: {
    segmentLengthsMeters: number[];
    turnAnglesDegrees: number[];
    turnDirections: TurnDirection[];
  },
  namePrefix = "Spor"
): Track {
  const points = createTrackPointsFromShape(start, headingDegrees, shape);
  const lengthMeters = shape.segmentLengthsMeters.reduce((sum, length) => sum + length, 0);

  return {
    id,
    displayNo,
    name: `${namePrefix} ${displayNo}`,
    templateCode: template.code,
    trackType: namePrefix,
    color: trackColors[(displayNo - 1) % trackColors.length],
    points,
    lengthSteps: Math.round(metersToSteps(lengthMeters, template.stepLengthMeters)),
    stepLengthMeters: template.stepLengthMeters,
    lengthMeters,
    rotationDegrees: headingDegrees,
    lockedLength: true,
    lockedAngles: true,
    objects: createTrackObjects(id, template, lengthMeters)
  };
}

export function createTrackPoints(
  start: Coordinate,
  headingDegrees: number,
  shape: TrackCandidateShape
): [Coordinate, Coordinate, Coordinate, Coordinate] {
  const radians = (headingDegrees * Math.PI) / 180;
  const headings = [
    radians,
    turnHeading(radians, shape.firstTurn),
    turnHeading(turnHeading(radians, shape.firstTurn), shape.secondTurn)
  ];

  const points: Coordinate[] = [start];

  shape.segmentLengthsMeters.forEach((length, index) => {
    const previous = points[points.length - 1];
    points.push({
      x: previous.x + Math.cos(headings[index]) * length,
      y: previous.y + Math.sin(headings[index]) * length
    });
  });

  return [points[0], points[1], points[2], points[3]];
}

export function createTrackPointsFromShape(
  start: Coordinate,
  headingDegrees: number,
  shape: {
    segmentLengthsMeters: number[];
    turnAnglesDegrees: number[];
    turnDirections: TurnDirection[];
  }
): Coordinate[] {
  let headingRadians = (headingDegrees * Math.PI) / 180;
  const points: Coordinate[] = [start];

  shape.segmentLengthsMeters.forEach((length, index) => {
    const previous = points[points.length - 1];
    points.push({
      x: previous.x + Math.cos(headingRadians) * length,
      y: previous.y + Math.sin(headingRadians) * length
    });

    const turnAngle = shape.turnAnglesDegrees[index];
    const turnDirection = shape.turnDirections[index];
    if (turnAngle !== undefined && turnDirection) {
      headingRadians += (turnDirection === "left" ? 1 : -1) * ((180 - turnAngle) * Math.PI) / 180;
    }
  });

  return points;
}

export function objectCoordinate(track: Track, objectId: string): Coordinate | undefined {
  const object = track.objects.find((candidate) => candidate.id === objectId);
  return object ? coordinateAtDistance(track.points, object.distanceAlongTrackMeters) : undefined;
}

function turnHeading(currentRadians: number, direction: TurnDirection): number {
  return currentRadians + (direction === "left" ? Math.PI / 2 : -Math.PI / 2);
}

function createTrackObjects(id: string, template: TrackTemplateRules, lengthMeters: number): Track["objects"] {
  if (template.objectCount <= 0) {
    return [];
  }

  const startOffset = Math.min(lengthMeters / 3, template.minObjectDistanceFromTurnMeters);
  const finishBuffer = Math.min(lengthMeters / 4, template.minLastObjectToFinishMeters);
  const usableFinish = Math.max(startOffset, lengthMeters - finishBuffer);
  const ordinaryCount = Math.max(0, template.objectCount - 1);
  const ordinaryObjects = Array.from({ length: ordinaryCount }, (_, index) => {
    const distanceAlongTrackMeters =
      ordinaryCount === 1
        ? startOffset + (usableFinish - startOffset) / 2
        : startOffset + ((usableFinish - startOffset) * index) / Math.max(1, ordinaryCount - 1);

    return {
      id: `${id}-object-${index + 1}`,
      displayNo: index + 1,
      distanceAlongTrackMeters,
      material: template.objectMaterial,
      description: `Genstand ${index + 1}`
    };
  });

  return [
    ...ordinaryObjects,
    {
      id: `${id}-object-${template.objectCount}`,
      displayNo: template.objectCount,
      distanceAlongTrackMeters: lengthMeters,
      material: template.objectMaterial,
      description: "Afslutningsgenstand",
      marksFinish: true
    }
  ];
}
