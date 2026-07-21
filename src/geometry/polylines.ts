import type { Coordinate, Track } from "@/domain/types";

export function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function calculateSegmentLengths(points: Coordinate[]): number[] {
  return points.slice(1).map((point, index) => distance(points[index], point));
}

export function calculateTrackLength(track: Pick<Track, "points">): number {
  return calculateSegmentLengths(track.points).reduce((sum, length) => sum + length, 0);
}

export function calculateTurnAngles(points: Coordinate[]): number[] {
  const angles: number[] = [];

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const a = { x: previous.x - current.x, y: previous.y - current.y };
    const b = { x: next.x - current.x, y: next.y - current.y };
    const dot = a.x * b.x + a.y * b.y;
    const magnitude = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    const clamped = Math.max(-1, Math.min(1, dot / magnitude));
    angles.push((Math.acos(clamped) * 180) / Math.PI);
  }

  return angles;
}

export function coordinateAtDistance(points: Coordinate[], distanceAlongMeters: number): Coordinate {
  if (points.length === 0) {
    throw new Error("Polyline mangler punkter.");
  }

  let remaining = Math.max(0, distanceAlongMeters);

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentLength = distance(start, end);

    if (remaining <= segmentLength) {
      const t = segmentLength === 0 ? 0 : remaining / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t
      };
    }

    remaining -= segmentLength;
  }

  return points[points.length - 1];
}

function orientation(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function isOnSegment(a: Coordinate, b: Coordinate, c: Coordinate): boolean {
  return (
    Math.min(a.x, c.x) <= b.x + Number.EPSILON &&
    b.x <= Math.max(a.x, c.x) + Number.EPSILON &&
    Math.min(a.y, c.y) <= b.y + Number.EPSILON &&
    b.y <= Math.max(a.y, c.y) + Number.EPSILON
  );
}

export function segmentsIntersect(
  a1: Coordinate,
  a2: Coordinate,
  b1: Coordinate,
  b2: Coordinate
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (Math.abs(o1) < Number.EPSILON && isOnSegment(a1, b1, a2)) return true;
  if (Math.abs(o2) < Number.EPSILON && isOnSegment(a1, b2, a2)) return true;
  if (Math.abs(o3) < Number.EPSILON && isOnSegment(b1, a1, b2)) return true;
  if (Math.abs(o4) < Number.EPSILON && isOnSegment(b1, a2, b2)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

export function doesTrackSelfIntersect(track: Pick<Track, "points">): boolean {
  const points = track.points;

  for (let a = 0; a < points.length - 1; a += 1) {
    for (let b = a + 2; b < points.length - 1; b += 1) {
      if (segmentsIntersect(points[a], points[a + 1], points[b], points[b + 1])) {
        return true;
      }
    }
  }

  return false;
}

export function reverseTrack(track: Track): Track {
  return {
    ...track,
    points: [...track.points].reverse(),
    objects: track.objects.map((object) => ({
      ...object,
      distanceAlongTrackMeters: track.lengthMeters - object.distanceAlongTrackMeters
    }))
  };
}
