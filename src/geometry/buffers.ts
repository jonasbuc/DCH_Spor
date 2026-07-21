import type { Coordinate, Track } from "@/domain/types";
import { polygonCentroid } from "@/geometry/polygons";
import { calculateSegmentLengths } from "@/geometry/polylines";

export function createInnerUsablePolygon(polygon: Coordinate[], marginMeters: number): Coordinate[] {
  if (marginMeters <= 0) {
    return polygon.map((point) => ({ ...point }));
  }

  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const isAxisAlignedRectangle =
    polygon.length === 4 &&
    polygon.every((point) => (point.x === minX || point.x === maxX) && (point.y === minY || point.y === maxY));

  if (isAxisAlignedRectangle && maxX - minX > marginMeters * 2 && maxY - minY > marginMeters * 2) {
    return polygon.map((point) => ({
      x: point.x === minX ? point.x + marginMeters : point.x - marginMeters,
      y: point.y === minY ? point.y + marginMeters : point.y - marginMeters
    }));
  }

  const centroid = polygonCentroid(polygon);

  return polygon.map((point) => {
    const vectorX = centroid.x - point.x;
    const vectorY = centroid.y - point.y;
    const length = Math.hypot(vectorX, vectorY);

    if (length <= marginMeters) {
      return { ...point };
    }

    return {
      x: point.x + (vectorX / length) * marginMeters,
      y: point.y + (vectorY / length) * marginMeters
    };
  });
}

export function createBufferedTrackGeometry(track: Pick<Track, "points">, bufferMeters: number): Coordinate[] {
  const points = track.points;

  if (points.length < 2 || bufferMeters <= 0) {
    return points.map((point) => ({ ...point }));
  }

  const left: Coordinate[] = [];
  const right: Coordinate[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: -dy / length, y: dx / length };

    left.push({
      x: points[index].x + normal.x * bufferMeters,
      y: points[index].y + normal.y * bufferMeters
    });
    right.unshift({
      x: points[index].x - normal.x * bufferMeters,
      y: points[index].y - normal.y * bufferMeters
    });
  }

  return [...left, ...right];
}

export function usableAreaWarning(polygon: Coordinate[], marginMeters: number): string {
  if (marginMeters <= 0) {
    return "";
  }

  const segmentLengths = calculateSegmentLengths([...polygon, polygon[0]]);
  const shortestEdge = Math.min(...segmentLengths);

  if (shortestEdge < marginMeters * 2) {
    return "Kantmarginen er stor i forhold til markens smalleste kant; den anvendelige polygon er derfor en tilnærmelse.";
  }

  return "";
}
