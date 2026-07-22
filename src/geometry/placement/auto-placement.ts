import type { PlacementOptions, PlacementResult, ProjectSnapshot, Track, TrackTemplateRules, TurnDirection } from "@/domain/types";
import { createTrackFromShape, createTrackPointsFromShape } from "@/domain/track/create-track";
import { validateTrack } from "@/domain/validation/validation";
import { distanceBetweenTracks, nearestDistanceToBoundary } from "@/geometry/distances";
import { polygonBounds } from "@/geometry/polygons";
import { doesTrackSelfIntersect } from "@/geometry/polylines";

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
type GridBasis = {
  center: { x: number; y: number };
  u: { x: number; y: number };
  v: { x: number; y: number };
};
type GridBounds = {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
};

export function autoPlaceTracks(project: ProjectSnapshot, options: PlacementOptions): PlacementResult {
  const startedAt = performance.now();
  const random = seededRandom(options.seed);
  const candidates = createCandidates(project, options, random);
  const bestFirstCandidates = limitBestFirstCandidates(candidates, options);
  const beamCandidates = limitBeamCandidates(candidates, options);
  const attempts = [
    candidates,
    [...candidates].sort((a, b) => candidateBoundaryScore(b, project.field.polygon) - candidateBoundaryScore(a, project.field.polygon)),
    [...candidates].sort((a, b) => candidateCenterScore(a, project.field.polygon) - candidateCenterScore(b, project.field.polygon)),
    shuffleDeterministic(candidates, options.seed + 17)
  ];
  const results = [
    ...attempts.map((attempt) => placeGreedy(project, options, attempt)),
    placeBestFirst(project, options, bestFirstCandidates),
    placeBestFirst(project, options, shuffleDeterministic(bestFirstCandidates, options.seed + 31)),
    ...(beamCandidates.length > 0 ? [placeBeamSearch(project, options, beamCandidates)] : [])
  ];
  const best = results.sort((a, b) => scoreAttempt(b) - scoreAttempt(a))[0] ?? {
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

function placeBestFirst(project: ProjectSnapshot, options: PlacementOptions, candidates: Track[]): PlacementAttempt {
  const rejectedReasons: Record<string, number> = {};
  const fixedTracks = options.fixedTracks ?? [];
  const fixedCount = fixedTracks.length;
  const placed: Track[] = [...fixedTracks];
  const remaining = [...candidates];
  let candidatesEvaluated = 0;

  while (placed.length - fixedCount < options.requestedTrackCount && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      candidatesEvaluated += 1;
      const result = validateTrack(candidate, project.template, {
        fieldPolygon: project.field.polygon,
        restrictedAreas: project.restrictedAreas,
        otherTracks: placed,
        edgeMarginMeters: options.edgeMarginMeters,
        minimumTrackSpacingMeters: options.minimumTrackSpacingMeters
      });

      if (!result.valid) {
        const firstError = result.errors[0]?.code ?? "UNKNOWN";
        rejectedReasons[firstError] = (rejectedReasons[firstError] ?? 0) + 1;
        continue;
      }

      const score = scoreCandidate(candidate, placed, project, options);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      break;
    }

    const [selected] = remaining.splice(bestIndex, 1);
    const displayNo = placed.length + 1;
    placed.push({ ...selected, displayNo, name: `Spor ${displayNo}` });
    removeClearlyConflictingCandidates(remaining, selected, Math.max(options.minimumTrackSpacingMeters, project.template.minTrackSpacingMeters));
  }

  return { placed, fixedCount, candidatesEvaluated, rejectedReasons };
}

function placeBeamSearch(project: ProjectSnapshot, options: PlacementOptions, candidates: Track[]): PlacementAttempt {
  const fixedTracks = options.fixedTracks ?? [];
  const fixedCount = fixedTracks.length;
  const beamWidth = Math.max(18, Math.min(56, options.requestedTrackCount * 8));
  const beamRejectedReasons: Record<string, number> = {};
  let totalCandidatesEvaluated = 0;
  let states: PlacementAttempt[] = [
    {
      placed: [...fixedTracks],
      fixedCount,
      candidatesEvaluated: 0,
      rejectedReasons: {}
    }
  ];

  for (const candidate of candidates) {
    const expanded: PlacementAttempt[] = [...states];

    for (const state of states) {
      if (state.placed.length - fixedCount >= options.requestedTrackCount) {
        continue;
      }

      const result = validateTrack(candidate, project.template, {
        fieldPolygon: project.field.polygon,
        restrictedAreas: project.restrictedAreas,
        otherTracks: state.placed,
        edgeMarginMeters: options.edgeMarginMeters,
        minimumTrackSpacingMeters: options.minimumTrackSpacingMeters
      });
      totalCandidatesEvaluated += 1;

      const rejectedReasons = { ...state.rejectedReasons };
      if (!result.valid) {
        const firstError = result.errors[0]?.code ?? "UNKNOWN";
        beamRejectedReasons[firstError] = (beamRejectedReasons[firstError] ?? 0) + 1;
        rejectedReasons[firstError] = (rejectedReasons[firstError] ?? 0) + 1;
        expanded.push({
          ...state,
          candidatesEvaluated: state.candidatesEvaluated + 1,
          rejectedReasons
        });
        continue;
      }

      const displayNo = state.placed.length + 1;
      expanded.push({
        placed: [...state.placed, renamePlacedTrack(candidate, displayNo)],
        fixedCount,
        candidatesEvaluated: state.candidatesEvaluated + 1,
        rejectedReasons
      });
    }

    states = rankBeamStates(expanded, project, options).slice(0, beamWidth);
    if (states[0] && states[0].placed.length - fixedCount >= options.requestedTrackCount) {
      return {
        ...states[0],
        candidatesEvaluated: totalCandidatesEvaluated,
        rejectedReasons: beamRejectedReasons
      };
    }
  }

  const best = rankBeamStates(states, project, options)[0];
  return best
    ? {
        ...best,
        candidatesEvaluated: totalCandidatesEvaluated,
        rejectedReasons: beamRejectedReasons
      }
    : {
        placed: [...fixedTracks],
        fixedCount,
        candidatesEvaluated: totalCandidatesEvaluated,
        rejectedReasons: beamRejectedReasons
      };
}

function rankBeamStates(states: PlacementAttempt[], project: ProjectSnapshot, options: PlacementOptions): PlacementAttempt[] {
  const deduped = new Map<string, PlacementAttempt>();

  states.forEach((state) => {
    const key = state.placed
      .slice(state.fixedCount)
      .map((track) => track.id)
      .join("|");
    const existing = deduped.get(key);
    if (!existing || scoreBeamState(state, project, options) > scoreBeamState(existing, project, options)) {
      deduped.set(key, state);
    }
  });

  return [...deduped.values()].sort((a, b) => scoreBeamState(b, project, options) - scoreBeamState(a, project, options));
}

function scoreBeamState(state: PlacementAttempt, project: ProjectSnapshot, options: PlacementOptions): number {
  const placed = state.placed.slice(state.fixedCount);
  const bounds = polygonBounds(project.field.polygon);
  const starts = placed.map((track) => track.points[0]);
  const coverage =
    starts.length <= 1
      ? 0
      : Math.max(...starts.map((point) => point.x)) -
        Math.min(...starts.map((point) => point.x)) +
        Math.max(...starts.map((point) => point.y)) -
        Math.min(...starts.map((point) => point.y));
  const centerPenalty = starts.reduce((sum, point) => {
    const centerX = bounds.minX + bounds.width / 2;
    const centerY = bounds.minY + bounds.height / 2;
    return sum + Math.hypot(point.x - centerX, point.y - centerY);
  }, 0);

  return scoreAttempt(state) + coverage * (options.placeInRows ? 1.2 : 0.4) - centerPenalty * 0.08;
}

function renamePlacedTrack(candidate: Track, displayNo: number): Track {
  return { ...candidate, displayNo, name: `Spor ${displayNo}` };
}

function scoreCandidate(candidate: Track, placed: Track[], project: ProjectSnapshot, options: PlacementOptions): number {
  const nearestTrackDistance =
    placed.length === 0 ? options.minimumTrackSpacingMeters * 2 : Math.min(...placed.map((track) => distanceBetweenTracks(candidate, track)));
  const desiredSpacing = Math.max(options.minimumTrackSpacingMeters, project.template.minTrackSpacingMeters) * 1.75;
  const spacingScore = Math.min(nearestTrackDistance, desiredSpacing) * 7;
  const boundaryDistance = nearestDistanceToBoundary(candidate.points, project.field.polygon);
  const boundaryScore = Math.min(Math.max(0, boundaryDistance), options.edgeMarginMeters + desiredSpacing) * 2;
  const centerPenalty = candidateCenterScore(candidate, project.field.polygon) * 0.025;
  const footprintPenalty = trackFootprintArea(candidate) * 0.0008;
  const alignmentPenalty = headingAlignmentPenalty(candidate.rotationDegrees, options.preferredDirectionDegrees) * (options.placeInRows ? 5 : 0.6);

  return spacingScore + boundaryScore - centerPenalty - footprintPenalty - alignmentPenalty;
}

function removeClearlyConflictingCandidates(candidates: Track[], selected: Track, spacingMeters: number) {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (distanceBetweenTracks(candidates[index], selected) < spacingMeters * 0.55) {
      candidates.splice(index, 1);
    }
  }
}

function gridBasis(center: GridBasis["center"], headingDegrees: number): GridBasis {
  const radians = (headingDegrees * Math.PI) / 180;
  return {
    center,
    u: { x: Math.cos(radians), y: Math.sin(radians) },
    v: { x: -Math.sin(radians), y: Math.cos(radians) }
  };
}

function localToWorld(basis: GridBasis, u: number, v: number): { x: number; y: number } {
  return {
    x: basis.center.x + basis.u.x * u + basis.v.x * v,
    y: basis.center.y + basis.u.y * u + basis.v.y * v
  };
}

function projectPolygonToGrid(polygon: ProjectSnapshot["field"]["polygon"], basis: GridBasis): GridBounds {
  const projected = polygon.map((point) => {
    const dx = point.x - basis.center.x;
    const dy = point.y - basis.center.y;
    return {
      u: dx * basis.u.x + dy * basis.u.y,
      v: dx * basis.v.x + dy * basis.v.y
    };
  });

  return {
    minU: Math.min(...projected.map((point) => point.u)),
    maxU: Math.max(...projected.map((point) => point.u)),
    minV: Math.min(...projected.map((point) => point.v)),
    maxV: Math.max(...projected.map((point) => point.v))
  };
}

function addCandidate(project: ProjectSnapshot, options: PlacementOptions, candidates: Track[], fingerprints: Set<string>, candidate: Track) {
  if (doesTrackSelfIntersect(candidate)) {
    return;
  }

  const result = validateTrack(candidate, project.template, {
    fieldPolygon: project.field.polygon,
    restrictedAreas: project.restrictedAreas,
    otherTracks: [],
    edgeMarginMeters: options.edgeMarginMeters,
    minimumTrackSpacingMeters: options.minimumTrackSpacingMeters
  });

  if (!result.valid) {
    return;
  }

  const fingerprint = candidateFingerprint(candidate);
  if (fingerprints.has(fingerprint)) {
    return;
  }

  fingerprints.add(fingerprint);
  candidates.push(candidate);
}

function candidateFingerprint(track: Track): string {
  return track.points.map((point) => `${Math.round(point.x * 4)},${Math.round(point.y * 4)}`).join("|");
}

function limitCandidates(candidates: Track[], options: PlacementOptions): Track[] {
  const maxCandidates = options.placeInRows
    ? Math.max(3_000, Math.min(14_000, options.requestedTrackCount * 800 + 2_000))
    : Math.max(800, Math.min(10_000, options.requestedTrackCount * 300 + 500));
  return sampleCandidates(candidates, maxCandidates);
}

function limitBestFirstCandidates(candidates: Track[], options: PlacementOptions): Track[] {
  const maxCandidates = options.placeInRows
    ? Math.max(1_500, Math.min(4_000, options.requestedTrackCount * 250 + 800))
    : Math.max(500, Math.min(2_500, options.requestedTrackCount * 80 + 400));
  return sampleCandidates(candidates, maxCandidates);
}

function limitBeamCandidates(candidates: Track[], options: PlacementOptions): Track[] {
  if (!options.placeInRows || options.requestedTrackCount > 20) {
    return [];
  }

  const maxCandidates = Math.max(320, Math.min(900, options.requestedTrackCount * 80 + 260));
  return sampleCandidates(candidates, maxCandidates);
}

function sampleCandidates(candidates: Track[], maxCandidates: number): Track[] {
  if (candidates.length <= maxCandidates) {
    return candidates;
  }

  const sampled: Track[] = [];
  const usedIndexes = new Set<number>();
  const step = candidates.length / maxCandidates;

  for (let index = 0; index < maxCandidates; index += 1) {
    const candidateIndex = Math.min(candidates.length - 1, Math.floor(index * step));
    if (!usedIndexes.has(candidateIndex)) {
      usedIndexes.add(candidateIndex);
      sampled.push(candidates[candidateIndex]);
    }
  }

  return sampled;
}

function trackFootprintArea(track: Track): number {
  const xs = track.points.map((point) => point.x);
  const ys = track.points.map((point) => point.y);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
}

function headingAlignmentPenalty(headingDegrees: number, preferredDirectionDegrees: number): number {
  return Math.min(angularDistanceDegrees(headingDegrees, preferredDirectionDegrees), angularDistanceDegrees(headingDegrees, preferredDirectionDegrees + 180));
}

function angularDistanceDegrees(a: number, b: number): number {
  const diff = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
  return Math.min(diff, 360 - diff);
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
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
  const center = { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
  const spacing = Math.max(8, options.minimumTrackSpacingMeters, project.template.minTrackSpacingMeters);
  const defaultShapes = createTemplateShapes(project);
  const shapes = sortShapesByFootprint(defaultShapes.length > 0 ? defaultShapes : [fallbackShape(project.template)]);
  const rotations = createRotations(options.preferredDirectionDegrees, options.placeInRows);
  const candidateShapes = options.sameShape || !options.varySegmentLengths ? [shapes[0]] : shapes;
  const candidates: Track[] = [];
  const fingerprints = new Set<string>();
  const rowOffsetFractions = [0, 1 / 6, 1 / 3, 1 / 2, 2 / 3, 5 / 6];
  const offsets = options.placeInRows
    ? rowOffsetFractions.flatMap((u) => [0, 0.25, 0.5, 0.75].map((v) => ({ u, v })))
    : [
        { u: 0, v: 0 },
        { u: 0.35, v: 0.65 }
      ];

  for (const shape of candidateShapes) {
    const footprint = shapeFootprint(shape);
    const exploratoryStep = Math.max(spacing * 1.4, Math.min(Math.max(footprint.width, footprint.height) * 0.3, spacing * 4));
    const xStep = options.placeInRows ? Math.max(spacing, footprint.width + spacing * 0.82) : exploratoryStep;
    const yStep = options.placeInRows ? Math.max(spacing, footprint.height + spacing * 0.82) : exploratoryStep;

    for (const rotation of rotations) {
      const basis = gridBasis(center, rotation);
      const projectedBounds = projectPolygonToGrid(project.field.polygon, basis);
      const searchPadding = options.placeInRows ? 0 : Math.max(footprint.width, footprint.height, spacing);
      const rowMargin = options.placeInRows ? options.edgeMarginMeters : 0;
      const minU = projectedBounds.minU - searchPadding + rowMargin;
      const maxU = projectedBounds.maxU + searchPadding - rowMargin;
      const minV = projectedBounds.minV - searchPadding + rowMargin;
      const maxV = projectedBounds.maxV + searchPadding - rowMargin;

      offsets.forEach((offset) => {
        let rowIndex = 0;
        for (let v = minV + offset.v * yStep; v <= maxV; v += yStep) {
          for (let u = minU + offset.u * xStep; u <= maxU; u += xStep) {
            const start = localToWorld(basis, u, v);
            const alternate = options.alternateStartDirections && rowIndex % 2 === 1 ? 180 : 0;
            const jitter = options.placeInRows ? 0 : (random() - 0.5) * spacing;
            const yJitter = options.placeInRows ? 0 : (random() - 0.5) * 2;
            const candidateStart = {
              x: start.x + jitter * basis.u.x + yJitter * basis.v.x,
              y: start.y + jitter * basis.u.y + yJitter * basis.v.y
            };

            addCandidate(
              project,
              options,
              candidates,
              fingerprints,
              createCandidateTrack(
                project,
                `candidate-${candidates.length + 1}`,
                candidates.length + 1,
                candidateStart,
                rotation + alternate,
                shape
              )
            );

            if (options.allowMirror) {
              addCandidate(
                project,
                options,
                candidates,
                fingerprints,
                createCandidateTrack(
                  project,
                  `candidate-${candidates.length + 1}`,
                  candidates.length + 1,
                  candidateStart,
                  rotation + alternate + 180,
                  shape
                )
              );
            }
          }
          rowIndex += 1;
        }
      });
    }
  }

  const ordered = options.placeInRows
    ? candidates.sort((a, b) => a.points[0].y - b.points[0].y || a.points[0].x - b.points[0].x)
    : candidates.sort((a, b) => candidateScore(a, bounds) - candidateScore(b, bounds));

  return limitCandidates(ordered, options);
}

function createTemplateShapes(project: ProjectSnapshot): CandidateShape[] {
  const expectedAngles = project.template.turnAnglesDegrees ?? Array.from({ length: project.template.turnCount }, () => project.template.turnAngleDegrees);

  if (expectedAngles.length === 2 && expectedAngles.every((angle) => Math.abs(angle - 90) < 0.0001)) {
    return createBLikeShapes(project.template);
  }

  return limitShapes(
    sortShapesByFootprint(uniqueShapes([...createProfileShapes(project.template, expectedAngles), ...createGenericShapes(project.template, expectedAngles)])),
    project.template.code === "DCH_E" ? 30 : 24
  );
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
  const innerOptions = uniqueNumbers([
    minimumInner,
    Math.max(minimumInner, lengthMeters / (segmentCount + 3)),
    Math.max(minimumInner, lengthMeters / (segmentCount + 2)),
    Math.max(minimumInner, lengthMeters / (segmentCount + 1))
  ]);

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

function createProfileShapes(template: TrackTemplateRules, turnAnglesDegrees: number[]): CandidateShape[] {
  const profileRatios: Record<string, number[][]> = {
    DCH_A: [
      [120, 90, 90, 150],
      [135, 75, 90, 150],
      [150, 90, 75, 135],
      [115, 105, 80, 150],
      [145, 80, 105, 120]
    ],
    DCH_E: [
      [120, 95, 95, 110, 95, 110, 125],
      [130, 90, 100, 95, 105, 95, 135],
      [105, 105, 90, 120, 90, 120, 120],
      [145, 80, 105, 90, 115, 85, 130],
      [115, 115, 80, 115, 100, 90, 135]
    ]
  };
  const ratios = profileRatios[template.code] ?? [];

  return ratios
    .filter((ratio) => ratio.length === turnAnglesDegrees.length + 1)
    .flatMap((ratio) => {
      const segmentLengthsMeters = segmentsFromRatios(template, ratio);
      return turnDirectionSets(turnAnglesDegrees.length).map((turnDirections) => ({
        segmentLengthsMeters,
        turnAnglesDegrees,
        turnDirections
      }));
    });
}

function segmentsFromRatios(template: TrackTemplateRules, ratios: number[]): number[] {
  const totalRatio = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const raw = ratios.map((ratio) => (ratio / totalRatio) * template.lengthMeters);

  if (raw.length <= 2) {
    return raw;
  }

  const middle = raw.slice(1, -1).map((length) => Math.max(template.minMiddleSegmentMeters, length));
  const middleTotal = middle.reduce((sum, length) => sum + length, 0);
  const remainingForEnds = Math.max(2, template.lengthMeters - middleTotal);
  const endRatioTotal = Math.max(1, raw[0] + raw[raw.length - 1]);
  const first = remainingForEnds * (raw[0] / endRatioTotal);
  const last = remainingForEnds * (raw[raw.length - 1] / endRatioTotal);

  return [first, ...middle, last];
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

function uniqueShapes(shapes: CandidateShape[]): CandidateShape[] {
  const seen = new Set<string>();

  return shapes.filter((shape) => {
    const fingerprint = shapeFingerprint(shape);
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function shapeFingerprint(shape: CandidateShape): string {
  const lengths = shape.segmentLengthsMeters.map((length) => length.toFixed(1)).join(",");
  const angles = shape.turnAnglesDegrees.map((angle) => angle.toFixed(1)).join(",");
  const turns = shape.turnDirections.join(",");
  return `${lengths}|${angles}|${turns}`;
}

function limitShapes(shapes: CandidateShape[], maxCount: number): CandidateShape[] {
  if (shapes.length <= maxCount) {
    return shapes;
  }

  return shapes.slice(0, maxCount);
}

function turnDirectionSets(count: number): TurnDirection[][] {
  const alternatingLeft = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? "left" : "right") as TurnDirection);
  const alternatingRight = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? "right" : "left") as TurnDirection);
  const leftPairs = Array.from({ length: count }, (_, index) => (Math.floor(index / 2) % 2 === 0 ? "left" : "right") as TurnDirection);
  const rightPairs = Array.from({ length: count }, (_, index) => (Math.floor(index / 2) % 2 === 0 ? "right" : "left") as TurnDirection);
  const leftSweep = Array.from({ length: count }, (_, index) => ([0, 3, 4].includes(index % 6) ? "left" : "right") as TurnDirection);
  const rightSweep = Array.from({ length: count }, (_, index) => ([0, 3, 4].includes(index % 6) ? "right" : "left") as TurnDirection);
  return uniqueDirectionSets([
    alternatingLeft,
    alternatingRight,
    leftPairs,
    rightPairs,
    leftSweep,
    rightSweep,
    Array.from({ length: count }, () => "left" as TurnDirection),
    Array.from({ length: count }, () => "right" as TurnDirection)
  ]);
}

function uniqueDirectionSets(sets: TurnDirection[][]): TurnDirection[][] {
  const seen = new Set<string>();

  return sets.filter((set) => {
    const fingerprint = set.join(",");
    if (seen.has(fingerprint)) {
      return false;
    }
    seen.add(fingerprint);
    return true;
  });
}

function uniqueNumbers(values: number[]): number[] {
  const rounded = values.map((value) => Number(value.toFixed(3)));
  return [...new Set(rounded)];
}

function createRotations(preferredDirectionDegrees: number, placeInRows = false): number[] {
  const offsets = placeInRows ? [0] : [0, 5, -5, 10, -10, 15, -15, 90, -90];
  return offsets.map((offset) => preferredDirectionDegrees + offset);
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
