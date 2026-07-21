import type { Axis, Coordinate, Track } from "@/domain/types";
import { calculateTurnAngles } from "@/geometry/polylines";

export function rotatePoint(point: Coordinate, angleDegrees: number, origin: Coordinate): Coordinate {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos
  };
}

export function rotateTrack(track: Track, angleDegrees: number, origin = track.points[0]): Track {
  return {
    ...track,
    rotationDegrees: (track.rotationDegrees + angleDegrees + 360) % 360,
    points: track.points.map((point) => rotatePoint(point, angleDegrees, origin))
  };
}

export function translateTrack(track: Track, dx: number, dy: number): Track {
  return {
    ...track,
    points: track.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
  };
}

export function mirrorTrack(track: Track, axis: Axis): Track {
  const origin = track.points[0];

  return {
    ...track,
    points: track.points.map((point) => ({
      x: axis === "y" ? origin.x - (point.x - origin.x) : point.x,
      y: axis === "x" ? origin.y - (point.y - origin.y) : point.y
    }))
  };
}

export function snapTurnToRightAngle(track: Track, vertexIndex: number): Track {
  if (vertexIndex <= 0 || vertexIndex >= track.points.length - 1) {
    return track;
  }

  const points = [...track.points];
  const previous = points[vertexIndex - 1];
  const current = points[vertexIndex];
  const next = points[vertexIndex + 1];
  const incoming = Math.atan2(current.y - previous.y, current.x - previous.x);
  const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
  const currentOutgoing = Math.atan2(next.y - current.y, next.x - current.x);
  const rightAngleOptions = [incoming + Math.PI / 2, incoming - Math.PI / 2];
  const selectedAngle =
    Math.abs(normalizeRadians(rightAngleOptions[0] - currentOutgoing)) <
    Math.abs(normalizeRadians(rightAngleOptions[1] - currentOutgoing))
      ? rightAngleOptions[0]
      : rightAngleOptions[1];

  points[vertexIndex + 1] = {
    x: current.x + Math.cos(selectedAngle) * outgoingLength,
    y: current.y + Math.sin(selectedAngle) * outgoingLength
  };

  const snappedTrack = { ...track, points };
  const angles = calculateTurnAngles(snappedTrack.points);

  return angles.every((angle) => Math.abs(angle - 90) < 0.0001) ? snappedTrack : track;
}

function normalizeRadians(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}
