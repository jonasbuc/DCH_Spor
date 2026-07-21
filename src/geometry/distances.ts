import type { Coordinate, Track } from "@/domain/types";
import { distance, segmentsIntersect } from "@/geometry/polylines";

export function distancePointToSegment(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;

  if (segmentLengthSquared === 0) {
    return distance(point, start);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
        segmentLengthSquared
    )
  );

  return distance(point, {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y)
  });
}

export function distanceBetweenSegments(
  a1: Coordinate,
  a2: Coordinate,
  b1: Coordinate,
  b2: Coordinate
): number {
  if (segmentsIntersect(a1, a2, b1, b2)) {
    return 0;
  }

  return Math.min(
    distancePointToSegment(a1, b1, b2),
    distancePointToSegment(a2, b1, b2),
    distancePointToSegment(b1, a1, a2),
    distancePointToSegment(b2, a1, a2)
  );
}

export function distanceBetweenPolylines(a: Coordinate[], b: Coordinate[]): number {
  let minimum = Number.POSITIVE_INFINITY;

  for (let ai = 0; ai < a.length - 1; ai += 1) {
    for (let bi = 0; bi < b.length - 1; bi += 1) {
      minimum = Math.min(minimum, distanceBetweenSegments(a[ai], a[ai + 1], b[bi], b[bi + 1]));
    }
  }

  return minimum;
}

export function distanceBetweenTracks(trackA: Pick<Track, "points">, trackB: Pick<Track, "points">): number {
  return distanceBetweenPolylines(trackA.points, trackB.points);
}

export function tracksIntersect(trackA: Pick<Track, "points">, trackB: Pick<Track, "points">): boolean {
  for (let ai = 0; ai < trackA.points.length - 1; ai += 1) {
    for (let bi = 0; bi < trackB.points.length - 1; bi += 1) {
      if (segmentsIntersect(trackA.points[ai], trackA.points[ai + 1], trackB.points[bi], trackB.points[bi + 1])) {
        return true;
      }
    }
  }

  return false;
}

export function nearestDistanceToBoundary(points: Coordinate[], polygon: Coordinate[]): number {
  let minimum = Number.POSITIVE_INFINITY;

  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      minimum = Math.min(minimum, distanceBetweenSegments(points[pointIndex], points[pointIndex + 1], start, end));
    }
  }

  if (Number.isFinite(minimum)) {
    return minimum;
  }

  return Math.min(
    ...points.flatMap((point) =>
      polygon.map((start, index) => distancePointToSegment(point, start, polygon[(index + 1) % polygon.length]))
    )
  );
}
