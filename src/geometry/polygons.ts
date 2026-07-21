import type { Coordinate, FieldPolygon, RestrictedArea, Track } from "@/domain/types";
import { distance, segmentsIntersect } from "@/geometry/polylines";
import { distancePointToSegment } from "@/geometry/distances";

export function calculatePolygonArea(polygon: Coordinate[]): number {
  if (polygon.length < 3) {
    return 0;
  }

  const doubleArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);

  return Math.abs(doubleArea) / 2;
}

export function calculatePolygonPerimeter(polygon: Coordinate[]): number {
  if (polygon.length < 2) {
    return 0;
  }

  return polygon.reduce((sum, point, index) => sum + distance(point, polygon[(index + 1) % polygon.length]), 0);
}

export function polygonCentroid(polygon: Coordinate[]): Coordinate {
  if (polygon.length === 0) {
    return { x: 0, y: 0 };
  }

  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const factor = current.x * next.y - next.x * current.y;
    twiceArea += factor;
    x += (current.x + next.x) * factor;
    y += (current.y + next.y) * factor;
  }

  if (Math.abs(twiceArea) < Number.EPSILON) {
    return {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length
    };
  }

  return {
    x: x / (3 * twiceArea),
    y: y / (3 * twiceArea)
  };
}

export function isPointInsidePolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  let inside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function isPolylineInsidePolygon(points: Coordinate[], polygon: Coordinate[]): boolean {
  if (points.some((point) => !isPointInsidePolygon(point, polygon))) {
    return false;
  }

  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const edgeStart = polygon[edgeIndex];
      const edgeEnd = polygon[(edgeIndex + 1) % polygon.length];

      if (segmentsIntersect(points[segmentIndex], points[segmentIndex + 1], edgeStart, edgeEnd)) {
        return false;
      }
    }
  }

  return true;
}

export function isTrackInsidePolygon(track: Pick<Track, "points">, fieldPolygon: FieldPolygon): boolean {
  return isPolylineInsidePolygon(track.points, fieldPolygon);
}

export function polygonBounds(polygon: Coordinate[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

export function doesPolylineIntersectPolygon(points: Coordinate[], polygon: Coordinate[]): boolean {
  if (points.some((point) => isPointInsidePolygon(point, polygon))) {
    return true;
  }

  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      if (
        segmentsIntersect(
          points[segmentIndex],
          points[segmentIndex + 1],
          polygon[edgeIndex],
          polygon[(edgeIndex + 1) % polygon.length]
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export function doesTrackIntersectObstacle(track: Pick<Track, "points">, obstacle: RestrictedArea): boolean {
  if (!obstacle.active) {
    return false;
  }

  if (obstacle.type === "polygon") {
    return doesPolylineIntersectPolygon(track.points, obstacle.polygon);
  }

  if (obstacle.type === "line") {
    for (let trackIndex = 0; trackIndex < track.points.length - 1; trackIndex += 1) {
      for (let lineIndex = 0; lineIndex < obstacle.line.length - 1; lineIndex += 1) {
        const segmentDistance = distancePointToSegment(
          track.points[trackIndex],
          obstacle.line[lineIndex],
          obstacle.line[lineIndex + 1]
        );
        const reverseDistance = distancePointToSegment(
          obstacle.line[lineIndex],
          track.points[trackIndex],
          track.points[trackIndex + 1]
        );

        if (Math.min(segmentDistance, reverseDistance) <= obstacle.safetyDistanceMeters) {
          return true;
        }
      }
    }

    return false;
  }

  return track.points.some(
    (point) => distance(point, obstacle.center) <= obstacle.radiusMeters + obstacle.safetyDistanceMeters
  );
}

export function toClosedRing(polygon: Coordinate[]): number[][] {
  if (polygon.length === 0) {
    return [];
  }

  const ring = polygon.map((point) => [point.x, point.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([...first]);
  }

  return ring;
}
