import type { FeatureCollection, LineString, Polygon } from "geojson";
import type { Coordinate, ProjectSnapshot, Track } from "@/domain/types";
import { calculateSegmentLengths, calculateTrackLength, coordinateAtDistance } from "@/geometry/polylines";
import { toClosedRing } from "@/geometry/polygons";
import { formatHectares, formatMeters, formatSquareMeters } from "@/utils/locale";

export function projectToGeoJson(project: ProjectSnapshot): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          kind: "field",
          name: project.field.name,
          areaM2: project.field.areaM2,
          areaHa: project.field.areaHa,
          sourceType: project.field.sourceType,
          projection: project.field.mapReference?.projection,
          originEasting: project.field.mapReference?.originEasting,
          originNorthing: project.field.mapReference?.originNorthing
        },
        geometry: {
          type: "Polygon",
          coordinates: [toClosedRing(project.field.polygon)]
        }
      },
      ...project.restrictedAreas.map((area) => ({
        type: "Feature" as const,
        properties: {
          kind: "restricted-area",
          name: area.name,
          areaType: area.areaType,
          active: area.active,
          safetyDistanceMeters: area.safetyDistanceMeters
        },
        geometry:
          area.type === "polygon"
            ? ({ type: "Polygon", coordinates: [toClosedRing(area.polygon)] } as Polygon)
            : area.type === "line"
              ? ({ type: "LineString", coordinates: area.line.map((point) => [point.x, point.y]) } as LineString)
              : circleToPolygon(area.center, area.radiusMeters)
      })),
      ...project.tracks.map((track) => ({
        type: "Feature" as const,
        properties: {
          kind: "track",
          id: track.id,
          name: track.name,
          displayNo: track.displayNo,
          lengthSteps: track.lengthSteps,
          lengthMeters: calculateTrackLength(track)
        },
        geometry: {
          type: "LineString" as const,
          coordinates: track.points.map((point) => [point.x, point.y])
        }
      }))
    ]
  };
}

export function projectToSvg(project: ProjectSnapshot, options: { width?: number; height?: number } = {}): string {
  const width = options.width ?? 1400;
  const height = options.height ?? 900;
  const padding = 72;
  const bounds = boundsFor(project.field.polygon);
  const scale = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
  const transform = (point: Coordinate): Coordinate => ({
    x: padding + (point.x - bounds.minX) * scale,
    y: padding + (point.y - bounds.minY) * scale
  });

  const polygonPoints = project.field.polygon.map(transform).map(pointToSvg).join(" ");
  const backgroundSvg = project.field.backgroundImage ? backgroundToSvg(project.field.backgroundImage, transform, scale) : "";
  const obstacleSvg = project.restrictedAreas
    .filter((area) => area.active)
    .map((area) => {
      if (area.type === "polygon") {
        return `<polygon points="${area.polygon.map(transform).map(pointToSvg).join(" ")}" fill="${area.color}" opacity="0.22" stroke="${area.color}" stroke-width="2" />`;
      }
      if (area.type === "circle") {
        const center = transform(area.center);
        return `<circle cx="${center.x}" cy="${center.y}" r="${area.radiusMeters * scale}" fill="${area.color}" opacity="0.2" stroke="${area.color}" stroke-width="2" />`;
      }
      const points = area.line.map(transform).map(pointToSvg).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${area.color}" stroke-width="${Math.max(2, area.safetyDistanceMeters * scale)}" opacity="0.25" />`;
    })
    .join("\n");

  const tracksSvg = project.tracks.map((track) => trackToSvg(track, transform, scale)).join("\n");
  const scaleBarMeters = 50;
  const scaleBarX = width - padding - scaleBarMeters * scale;
  const scaleBarY = height - padding / 2;
  const calibrationNote = project.field.calibration?.warningDa ? "Omtrentligt kalibreret" : "Målfast plan";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(project.name)}">
  <rect width="100%" height="100%" fill="#f7faf7" />
  <text x="${padding}" y="34" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#16201b">${escapeXml(project.name)}</text>
  <text x="${padding}" y="59" font-family="Inter, Arial, sans-serif" font-size="14" fill="#34443a">${escapeXml(project.club)} · ${formatSquareMeters(project.field.areaM2)} · ${formatHectares(project.field.areaM2)} · ${escapeXml(calibrationNote)}</text>
  ${backgroundSvg}
  <polygon points="${polygonPoints}" fill="#d9eed9" stroke="#2f6235" stroke-width="3" />
  ${obstacleSvg}
  ${tracksSvg}
  <line x1="${scaleBarX}" y1="${scaleBarY}" x2="${scaleBarX + scaleBarMeters * scale}" y2="${scaleBarY}" stroke="#16201b" stroke-width="5" />
  <text x="${scaleBarX}" y="${scaleBarY - 10}" font-family="Inter, Arial, sans-serif" font-size="13" fill="#16201b">${formatMeters(scaleBarMeters, 0)}</text>
  <path d="M ${width - padding} ${padding} l 0 -26 l -8 14 l 8 -4 l 8 4 z" fill="#16201b" />
  <text x="${width - padding - 5}" y="${padding + 16}" font-family="Inter, Arial, sans-serif" font-size="13" text-anchor="middle" fill="#16201b">N</text>
</svg>`;
}

export function trackSheetMarkdown(project: ProjectSnapshot, track: Track): string {
  const segmentLengths = calculateSegmentLengths(track.points);
  const lengthMeters = calculateTrackLength(track);

  return [
    `# Sporlæggerark - ${track.name}`,
    "",
    `Projekt: ${project.name}`,
    `Klub: ${project.club || "-"}`,
    `Samlet længde: ${track.lengthSteps} skridt / ${formatMeters(lengthMeters)}`,
    `Segmenter: ${segmentLengths.map((length) => formatMeters(length)).join(" · ")}`,
    `Knæk: 2 x 90 grader`,
    "",
    "## Genstande",
    ...track.objects.map(
      (object) =>
        `- Genstand ${object.displayNo}: ${formatMeters(object.distanceAlongTrackMeters)} fra start, materiale: ${object.material}`
    ),
    "",
    "Tidspunkt for sporlægning: ____________________",
    "Sporlæggerens navn: __________________________",
    "",
    "Noter:",
    "",
    "________________________________________________",
    "________________________________________________"
  ].join("\n");
}

function backgroundToSvg(
  background: NonNullable<ProjectSnapshot["field"]["backgroundImage"]>,
  transform: (point: Coordinate) => Coordinate,
  scale: number
): string {
  const topLeft = transform({ x: background.x, y: background.y });
  const width = background.widthMeters * scale;
  const height = background.heightMeters * scale;
  const cropLeft = width * (background.crop.leftPercent / 100);
  const cropTop = height * (background.crop.topPercent / 100);
  const cropWidth = Math.max(1, width - cropLeft - width * (background.crop.rightPercent / 100));
  const cropHeight = Math.max(1, height - cropTop - height * (background.crop.bottomPercent / 100));
  const centerX = topLeft.x + width / 2;
  const centerY = topLeft.y + height / 2;
  const clipId = `bg-${background.storageKey.replace(/[^a-z0-9]/gi, "")}`;

  return `<defs><clipPath id="${clipId}"><rect x="${topLeft.x + cropLeft}" y="${topLeft.y + cropTop}" width="${cropWidth}" height="${cropHeight}" /></clipPath></defs>
  <g opacity="${background.opacity}" transform="rotate(${background.rotationDegrees} ${centerX} ${centerY})">
    <image href="${escapeXml(background.url)}" x="${topLeft.x}" y="${topLeft.y}" width="${width}" height="${height}" preserveAspectRatio="none" clip-path="url(#${clipId})" />
  </g>`;
}

function trackToSvg(track: Track, transform: (point: Coordinate) => Coordinate, scale: number): string {
  const points = track.points.map(transform);
  const objectSvg = track.objects
    .map((object) => {
      const position = transform(coordinateAtDistance(track.points, object.distanceAlongTrackMeters));
      return `<g><circle cx="${position.x}" cy="${position.y}" r="6" fill="#fff" stroke="${track.color}" stroke-width="3" /><text x="${position.x + 9}" y="${position.y - 7}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#16201b">G${object.displayNo}</text></g>`;
    })
    .join("\n");
  const start = points[0];
  const end = points[points.length - 1];
  const label = points[1];

  return `<g>
    <polyline points="${points.map(pointToSvg).join(" ")}" fill="none" stroke="${track.color}" stroke-width="${Math.max(4, scale * 0.9)}" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="${start.x}" cy="${start.y}" r="8" fill="${track.color}" />
    <rect x="${end.x - 6}" y="${end.y - 6}" width="12" height="12" fill="#fff" stroke="${track.color}" stroke-width="3" />
    <text x="${label.x + 8}" y="${label.y - 9}" font-family="Inter, Arial, sans-serif" font-size="14" font-weight="700" fill="${track.color}">${escapeXml(track.name)}</text>
    ${objectSvg}
  </g>`;
}

function circleToPolygon(center: Coordinate, radiusMeters: number): Polygon {
  const points = Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return [center.x + Math.cos(angle) * radiusMeters, center.y + Math.sin(angle) * radiusMeters];
  });
  points.push(points[0]);
  return { type: "Polygon", coordinates: [points] };
}

function boundsFor(points: Coordinate[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX || 1, height: maxY - minY || 1 };
}

function pointToSvg(point: Coordinate): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
