import type { Calibration, Coordinate } from "@/domain/types";
import { calculatePolygonArea } from "@/geometry/polygons";

export function calibrateByDistance(
  firstPoint: Coordinate,
  secondPoint: Coordinate,
  knownDistanceMeters: number
): Calibration {
  const pixelDistance = Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);

  if (pixelDistance <= 0 || knownDistanceMeters <= 0) {
    throw new Error("Kalibrering kræver både pixelafstand og kendt afstand.");
  }

  return {
    method: "distance",
    meterPerPixel: knownDistanceMeters / pixelDistance,
    knownDistanceMeters
  };
}

export function calibrateByKnownArea(polygonPixels: Coordinate[], knownAreaM2: number): Calibration {
  const polygonAreaPixels = calculatePolygonArea(polygonPixels);

  if (polygonAreaPixels <= 0 || knownAreaM2 <= 0) {
    throw new Error("Arealbaseret kalibrering kræver polygon og kendt areal.");
  }

  const meterPerPixel = Math.sqrt(knownAreaM2 / polygonAreaPixels);

  return {
    method: "area",
    meterPerPixel,
    knownAreaM2,
    calculatedAreaM2: polygonAreaPixels * meterPerPixel ** 2,
    deviationPercent: 0,
    warningDa:
      "Arealbaseret kalibrering er kun præcis, hvis billedet har ens målestok i begge retninger og ikke er perspektivforvrænget."
  };
}

export function calibrateByDimensions(
  pixelWidth: number,
  pixelHeight: number,
  knownWidthMeters: number,
  knownHeightMeters: number
): Calibration {
  if (pixelWidth <= 0 || pixelHeight <= 0 || knownWidthMeters <= 0 || knownHeightMeters <= 0) {
    throw new Error("Bredde/højde-kalibrering kræver positive værdier.");
  }

  const meterPerPixelX = knownWidthMeters / pixelWidth;
  const meterPerPixelY = knownHeightMeters / pixelHeight;
  const meterPerPixel = (meterPerPixelX + meterPerPixelY) / 2;
  const deviationPercent = (Math.abs(meterPerPixelX - meterPerPixelY) / meterPerPixel) * 100;

  return {
    method: "dimensions",
    meterPerPixel,
    knownWidthMeters,
    knownHeightMeters,
    deviationPercent,
    warningDa:
      deviationPercent > 2
        ? "Bredde og højde giver forskellig målestok. Planen bør behandles som omtrentligt kalibreret."
        : ""
  };
}
