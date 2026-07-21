import type {
  Coordinate,
  ProjectSnapshot,
  ProjectValidationResult,
  RestrictedArea,
  Track,
  TrackTemplateRules,
  ValidationMessage,
  ValidationResult
} from "@/domain/types";
import { distanceBetweenTracks, nearestDistanceToBoundary, tracksIntersect } from "@/geometry/distances";
import { calculateSegmentLengths, calculateTrackLength, calculateTurnAngles, doesTrackSelfIntersect } from "@/geometry/polylines";
import { doesTrackIntersectObstacle, isTrackInsidePolygon } from "@/geometry/polygons";
import { metersToSteps } from "@/utils/locale";

const geometryToleranceMeters = 1e-6;

export function validateProject(project: ProjectSnapshot): ProjectValidationResult {
  const tracks: Record<string, ValidationResult> = {};
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  for (const track of project.tracks) {
    const result = validateTrack(track, rulesForTrack(project, track), {
      fieldPolygon: project.field.polygon,
      restrictedAreas: project.restrictedAreas,
      otherTracks: project.tracks.filter((candidate) => candidate.id !== track.id),
      edgeMarginMeters: project.edgeMarginMeters,
      minimumTrackSpacingMeters: project.minimumTrackSpacingMeters
    });

    tracks[track.id] = result;
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  }

  return {
    valid: errors.length === 0,
    tracks,
    errors,
    warnings
  };
}

export function validateTrack(
  track: Track,
  rules: TrackTemplateRules,
  context: {
    fieldPolygon: Coordinate[];
    restrictedAreas?: RestrictedArea[];
    otherTracks?: Track[];
    edgeMarginMeters?: number;
    minimumTrackSpacingMeters?: number;
  }
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const segmentLengthsMeters = calculateSegmentLengths(track.points);
  const totalLengthMeters = calculateTrackLength(track);
  const turnAnglesDegrees = calculateTurnAngles(track.points);
  const expectedTurnAnglesDegrees = rules.turnAnglesDegrees ?? Array.from({ length: rules.turnCount }, () => rules.turnAngleDegrees);
  const expectedSegmentCount = expectedTurnAnglesDegrees.length + 1;
  const expectedPointCount = expectedSegmentCount + 1;
  const edgeMarginMeters = context.edgeMarginMeters ?? 0;
  const spacingMeters = context.minimumTrackSpacingMeters ?? rules.minTrackSpacingMeters;
  const nearestBoundaryDistanceMeters = nearestDistanceToBoundary(track.points, context.fieldPolygon);

  if (track.points.length !== expectedPointCount) {
    errors.push(
      message(
        "TRACK_POINT_COUNT",
        "error",
        `${rules.name} skal have ${expectedPointCount} punkter.`,
        track.id,
        track.points[0],
        track.points.length,
        expectedPointCount,
        "punkter"
      )
    );
  }

  if (segmentLengthsMeters.length !== expectedSegmentCount) {
    errors.push(
      message(
        "SEGMENT_COUNT",
        "error",
        `${rules.name} skal have ${expectedSegmentCount} ben.`,
        track.id,
        track.points[0],
        segmentLengthsMeters.length,
        expectedSegmentCount,
        "ben"
      )
    );
  }

  if (Math.abs(totalLengthMeters - rules.lengthMeters) > rules.lengthToleranceMeters) {
    errors.push(
      message(
        "TRACK_LENGTH",
        "error",
        `Samlet længde er ${totalLengthMeters.toFixed(1)} m.`,
        track.id,
        track.points[0],
        totalLengthMeters,
        rules.lengthMeters,
        "m"
      )
    );
  }

  turnAnglesDegrees.forEach((angle, index) => {
    const requiredAngle = expectedTurnAnglesDegrees[index] ?? rules.turnAngleDegrees;
    if (Math.abs(angle - requiredAngle) > rules.angleToleranceDegrees) {
      errors.push(
        message(
          "TURN_ANGLE",
          "error",
          `Knæk ${index + 1} er ${angle.toFixed(1)}°.`,
          track.id,
          track.points[index + 1],
          angle,
          requiredAngle,
          "grader"
        )
      );
    }
  });

  segmentLengthsMeters.slice(1, -1).forEach((middleLength, index) => {
    if (middleLength + geometryToleranceMeters < rules.minMiddleSegmentMeters) {
      errors.push(
        message(
          "MIDDLE_SEGMENT_LENGTH",
          "error",
          `Kun ${metersToSteps(middleLength, rules.stepLengthMeters).toFixed(1)} skridt mellem knæk ${index + 1} og ${index + 2}.`,
          track.id,
          track.points[index + 1],
          middleLength,
          rules.minMiddleSegmentMeters,
          "m"
        )
      );
    }
  });

  if (!isTrackInsidePolygon(track, context.fieldPolygon)) {
    errors.push(message("OUTSIDE_FIELD", "error", "Sporet ligger uden for markens afgrænsning.", track.id, track.points[0]));
  }

  if (nearestBoundaryDistanceMeters + geometryToleranceMeters < edgeMarginMeters) {
    errors.push(
      message(
        "EDGE_MARGIN",
        "error",
        `${Math.max(0, edgeMarginMeters - nearestBoundaryDistanceMeters).toFixed(1)} m mangler til kantmarginen.`,
        track.id,
        track.points[0],
        nearestBoundaryDistanceMeters,
        edgeMarginMeters,
        "m"
      )
    );
  }

  if (doesTrackSelfIntersect(track)) {
    errors.push(message("SELF_INTERSECTION", "error", "Sporet krydser sig selv.", track.id, track.points[0]));
  }

  for (const obstacle of context.restrictedAreas ?? []) {
    if (doesTrackIntersectObstacle(track, obstacle)) {
      errors.push(message("RESTRICTED_AREA", "error", `Sporet rammer ${obstacle.name}.`, track.id, track.points[0]));
    }
  }

  let nearestTrackDistanceMeters: number | undefined;
  for (const otherTrack of context.otherTracks ?? []) {
    if (tracksIntersect(track, otherTrack)) {
      nearestTrackDistanceMeters = 0;
      errors.push({
        ...message("TRACK_INTERSECTION", "error", `Sporet krydser ${otherTrack.name}.`, track.id, track.points[0], 0, spacingMeters, "m"),
        relatedTrackId: otherTrack.id
      });
      continue;
    }

    const distance = distanceBetweenTracks(track, otherTrack);
    nearestTrackDistanceMeters = Math.min(nearestTrackDistanceMeters ?? distance, distance);

    if (distance + geometryToleranceMeters < spacingMeters) {
      errors.push({
        ...message(
          "TRACK_SPACING",
          "error",
          `For tæt på ${otherTrack.name}: ${distance.toFixed(1)} m.`,
          track.id,
          track.points[0],
          distance,
          spacingMeters,
          "m"
        ),
        relatedTrackId: otherTrack.id
      });
    }
  }

  if (track.objects.length !== rules.objectCount) {
    warnings.push(
      message(
        "OBJECT_COUNT",
        "warning",
        `Sporet har ${track.objects.length} genstande.`,
        track.id,
        track.points[0],
        track.objects.length,
        rules.objectCount,
        "genstande"
      )
    );
  }

  for (const object of track.objects) {
    if (track.lengthMeters - object.distanceAlongTrackMeters < rules.minLastObjectToFinishMeters && !object.marksFinish) {
      warnings.push(
        message(
          "OBJECT_TOO_CLOSE_TO_FINISH",
          "warning",
          "Genstand ligger for tæt på afslutningen.",
          track.id,
          track.points[0],
          track.lengthMeters - object.distanceAlongTrackMeters,
          rules.minLastObjectToFinishMeters,
          "m"
        )
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    measurements: {
      totalLengthMeters,
      totalLengthSteps: metersToSteps(totalLengthMeters, rules.stepLengthMeters),
      segmentLengthsMeters,
      turnAnglesDegrees,
      nearestTrackDistanceMeters,
      nearestBoundaryDistanceMeters
    }
  };
}

function message(
  code: string,
  severity: "error" | "warning" | "info",
  messageDa: string,
  trackId?: string,
  position?: Coordinate,
  actualValue?: number,
  requiredValue?: number,
  unit?: string
): ValidationMessage {
  return {
    code,
    severity,
    messageDa,
    trackId,
    position,
    actualValue,
    requiredValue,
    unit
  };
}

function rulesForTrack(project: ProjectSnapshot, track: Track): TrackTemplateRules {
  if (!track.templateCode || track.templateCode === project.template.code) {
    return project.template;
  }

  return project.templates?.find((template) => template.code === track.templateCode) ?? project.template;
}
