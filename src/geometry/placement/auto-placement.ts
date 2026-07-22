import type { PlacementOptions, PlacementResult, ProjectSnapshot, Track, TrackTemplateRules, TurnDirection } from "@/domain/types";
import { createTrackFromShape, createTrackPointsFromShape } from "@/domain/track/create-track";
import { validateTrack } from "@/domain/validation/validation";
import { distanceBetweenTracks } from "@/geometry/distances";
import { polygonBounds } from "@/geometry/polygons";

type Random = () => number;
type PlacementAttempt = {
  placed: Track[];
  fixedCount: number;
  candidatesEvaluated: number;
  rejectedReasons: Record<string, number>;
};
type CandidateShape = {
  segmentLengthsMeters: number[];
  turnAnglesDegrees: number[];
  turnDirections: TurnDirection[];
};

export function autoPlaceTracks(project: ProjectSnapshot, options: PlacementOptions): PlacementResult {
  const startedAt = performance.now();
  const random = seededRandom(options.seed);
  const candidates = createCandidates(project, options, random);
  const attempts = [
    candidates,
    [...candidates].sort((a, b) => candidateBoundaryScore(b, project.field.polygon) - candidateBoundaryScore(a, project.field.polygon)),
    [...candidates].sort((a, b) => candidateCenterScore(a, project.field.polygon) - candidateCenterScore(b, project.field.polygon)),
    shuffleDeterministic(candidates, options.seed + 17)
  ];
  const best = attempts.map((attempt) => placeGreedy(project, options, attempt)).sort((a, b) => scoreAttempt(b) - scoreAttempt(a))[0] ?? {
    placed: options.fixedTracks ?? [],
    fixedCount: options.fixedTracks?.length ?? 0,
    candidatesEvaluated: 0,
    rejectedReasons: {}
  };
  const fixedCount = best.fixedCount;

  return {
    labelDa: "Bedste fundne forslag",
    tracks: best.placed,
    requestedTrackCount: options.requestedTrackCount,
    placedTrackCount: Math.max(0, best.placed.length - fixedCount),
    durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
    score: scoreAttempt(best),
    candidatesEvaluated: best.candidatesEvaluated,
    rejectedReasons: best.rejectedReasons
  };
}

function placeGreedy(project: ProjectSnapshot, options: PlacementOptions, candidates: Track[]): PlacementAttempt {
  const rejectedReasons: Record<string, number> = {};
  const fixedTracks = options.fixedTracks ?? [];
  const fixedCount = fixedTracks.length;
  const placed: Track[] = [...fixedTracks];
  let candidatesEvaluated = 0;

  for (const candidate of candidates) {
    if (placed.length - fixedCount >= options.requestedTrackCount) break;
    candidatesEvaluated += 1;
    const result = validateTrack(candidate, project.template, {
      fieldPolygon: project.field.polygon,
      restrictedAreas: project.restrictedAreas,
      otherTracks: placed,
      edgeMarginMeters: options.edgeMarginMeters,
      minimumTrackSpacingMeters: options.minimumTrackSpacingMeters
    });

    if (result.valid) {
      placed.push({ ...candidate, displayNo: placed.length + 1, name: `Spor ${placed.length + 1}` });
      continue;
    }

    const firstError = result.errors[0]?.code ?? "UNKNOWN";
    rejectedReasons[firstError] = (rejectedReasons[firstError] ?? 0) + 1;
  }

  return { placed, fixedCount, candidatesEvaluated, rejectedReasons };
}

function scoreAttempt(attempt: PlacementAttempt): number {
  const placed = attempt.placed.slice(attempt.fixedCount);
  const spacingBonus = placed.reduce((sum, track, index) => {
    const previous = attempt.placed.slice(0, attempt.fixedCount + index);
    if (previous.length === 0) {
      return sum;
    }
    return sum + Math.min(...previous.map((otherTrack) => distanceBetweenTracks(track, otherTrack)));
  }, 0);

  return placed.length * 10_000 + spacingBonus - attempt.candidatesEvaluated * 0.01;
}

function createCandidates(project: ProjectSnapshot, options: PlacementOptions, random: Random): Track[] {
  const bounds = polygonBounds(project.field.polygon);
  const spacing = Math.max(8, options.minimumTrackSpacingMeters);
  const defaultShapes = createTemplateShapes(project);
  const shapes = sortShapesByFootprint(defaultShapes.length > 0 ? defaultShapes : [fallbackShape(project.template)]);
  const footprint = shapeFootprint(shapes[0]);
  const compactWidth = footprint.width;
  const compactHeight = footprint.height;
  const xStep = options.placeInRows ? compactWidth + spacing : spacing;
  const yStep = options.placeInRows ? compactHeight + spacing : spacing;
  const rotations = createRotations(options.preferredDirectionDegrees);
  const candidateShapes = options.sameShape || !options.varySegmentLengths ? [shapes[0]] : shapes;
  const candidates: Track[] = [];

  for (let y = bounds.minY + options.edgeMarginMeters; y <= bounds.maxY - options.edgeMarginMeters; y += yStep) {
    for (let x = bounds.minX + options.edgeMarginMeters; x <= bounds.maxX - options.edgeMarginMeters; x += xStep) {
      for (const rotation of rotations) {
        for (const shape of candidateShapes) {
          const rowIndex = Math.floor((y - bounds.minY) / yStep);
          const alternate = options.alternateStartDirections && rowIndex % 2 === 1 ? 180 : 0;
          const jitter = options.placeInRows ? 0 : (random() - 0.5) * spacing;
          const yJitter = options.placeInRows ? 0 : (random() - 0.5) * 2;
          const candidate = createCandidateTrack(
            project,
            `candidate-${candidates.length + 1}`,
            candidates.length + 1,
            { x: x + jitter, y: y + yJitter },
            rotation + alternate,
            shape
          );
          candidates.push(candidate);

          if (options.allowMirror) {
            candidates.push(
              createCandidateTrack(
                project,
                `candidate-${candidates.length + 1}`,
                candidates.length + 1,
                { x: x + jitter, y: y + yJitter },
                rotation + alternate + 180,
                shape
              )
            );
          }
        }
      }
    }
  }

  if (options.placeInRows) {
    return candidates.sort((a, b) => a.points[0].y - b.points[0].y || a.points[0].x - b.points[0].x);
  }

  return candidates.sort((a, b) => candidateScore(a, bounds) - candidateScore(b, bounds));
}

function createTemplateShapes(project: ProjectSnapshot): CandidateShape[] {
  const expectedAngles = project.template.turnAnglesDegrees ?? Array.from({ length: project.template.turnCount }, () => project.template.turnAngleDegrees);

  if (expectedAngles.length === 2 && expectedAngles.every((angle) => Math.abs(angle - 90) < 0.0001)) {
    return createBLikeShapes(project.template);
  }

  return createGenericShapes(project.template, expectedAngles);
}

function createBLikeShapes(template: TrackTemplateRules): CandidateShape[] {
  const lengthMeters = template.lengthMeters;
  const minimumMiddle = Math.min(Math.max(1, template.minMiddleSegmentMeters), lengthMeters * 0.45);
  const middleOptions = uniqueNumbers([
    minimumMiddle,
    Math.max(minimumMiddle, lengthMeters * 0.2),
    Math.max(minimumMiddle, lengthMeters * 0.27)
  ]).filter((middle) => middle < lengthMeters - 2);

  return middleOptions.flatMap((middle) => {
    const sideLength = (lengthMeters - middle) / 2;
    const segmentLengthsMeters = [sideLength, middle, sideLength];
    return turnDirectionSets(2).map((turnDirections) => ({
      segmentLengthsMeters,
      turnAnglesDegrees: [90, 90],
      turnDirections
    }));
  });
}

function createGenericShapes(template: TrackTemplateRules, turnAnglesDegrees: number[]): CandidateShape[] {
  const lengthMeters = template.lengthMeters;
  const segmentCount = turnAnglesDegrees.length + 1;
  const innerCount = Math.max(0, segmentCount - 2);
  const minimumInner = Math.min(template.minMiddleSegmentMeters, lengthMeters / Math.max(2, segmentCount));
  const innerOptions = uniqueNumbers([minimumInner, Math.max(minimumInner, lengthMeters / (segmentCount + 2))]);

  return innerOptions.flatMap((innerLength) => {
    const innerTotal = innerLength * innerCount;
    const endLength = Math.max(1, (lengthMeters - innerTotal) / 2);
    const segmentLengthsMeters = [endLength, ...Array.from({ length: innerCount }, () => innerLength), endLength];
    const total = segmentLengthsMeters.reduce((sum, length) => sum + length, 0);
    const normalized = segmentLengthsMeters.map((length) => (length / total) * lengthMeters);

    return turnDirectionSets(turnAnglesDegrees.length).map((turnDirections) => ({
      segmentLengthsMeters: normalized,
      turnAnglesDegrees,
      turnDirections
    }));
  });
}

function createCandidateTrack(
  project: ProjectSnapshot,
  id: string,
  displayNo: number,
  start: { x: number; y: number },
  headingDegrees: number,
  shape: CandidateShape
): Track {
  return createTrackFromShape(
    id,
    displayNo,
    start,
    headingDegrees,
    project.template,
    shape,
    "Spor"
  );
}

function fallbackShape(template: TrackTemplateRules): CandidateShape {
  const turnAnglesDegrees = template.turnAnglesDegrees ?? Array.from({ length: template.turnCount }, () => template.turnAngleDegrees);
  return createGenericShapes(template, turnAnglesDegrees)[0];
}

function shapeFootprint(shape: CandidateShape): { width: number; height: number } {
  const points = createTrackPointsFromShape({ x: 0, y: 0 }, 0, shape);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys))
  };
}

function sortShapesByFootprint(shapes: CandidateShape[]): CandidateShape[] {
  return [...shapes].sort((a, b) => {
    const aFootprint = shapeFootprint(a);
    const bFootprint = shapeFootprint(b);
    return aFootprint.width * aFootprint.height - bFootprint.width * bFootprint.height;
  });
}

function turnDirectionSets(count: number): TurnDirection[][] {
  const alternatingLeft = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? "left" : "right") as TurnDirection);
  const alternatingRight = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? "right" : "left") as TurnDirection);
  return [alternatingLeft, alternatingRight, Array.from({ length: count }, () => "left" as TurnDirection), Array.from({ length: count }, () => "right" as TurnDirection)];
}

function uniqueNumbers(values: number[]): number[] {
  const rounded = values.map((value) => Number(value.toFixed(3)));
  return [...new Set(rounded)];
}

function createRotations(preferredDirectionDegrees: number): number[] {
  return [0, 5, -5, 10, -10, 15, -15, 90, -90].map((offset) => preferredDirectionDegrees + offset);
}

function candidateScore(track: Track, bounds: ReturnType<typeof polygonBounds>): number {
  const start = track.points[0];
  const centerX = bounds.minX + bounds.width / 2;
  const centerY = bounds.minY + bounds.height / 2;
  return Math.hypot(start.x - centerX, start.y - centerY);
}

function candidateCenterScore(track: Track, polygon: ProjectSnapshot["field"]["polygon"]): number {
  return candidateScore(track, polygonBounds(polygon));
}

function candidateBoundaryScore(track: Track, polygon: ProjectSnapshot["field"]["polygon"]): number {
  const bounds = polygonBounds(polygon);
  const start = track.points[0];
  return Math.min(start.x - bounds.minX, bounds.maxX - start.x, start.y - bounds.minY, bounds.maxY - start.y);
}

function shuffleDeterministic(candidates: Track[], seed: number): Track[] {
  const random = seededRandom(seed);
  const copy = [...candidates];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const item = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = item;
  }
  return copy;
}

function seededRandom(seed: number): Random {
  let state = seed >>> 0;

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}
