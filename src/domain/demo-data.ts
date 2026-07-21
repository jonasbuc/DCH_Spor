import type { ProjectSnapshot, Track, TrackCandidateShape } from "@/domain/types";
import { dchBTrackTemplate, dchTrackTemplates } from "@/domain/rules/templates";
import { createBTrack } from "@/domain/track/create-track";
import { calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";

const leftLeft: TrackCandidateShape = { firstTurn: "left", secondTurn: "left", segmentLengthsMeters: [63.75, 22.5, 63.75] };
const rightRight: TrackCandidateShape = { firstTurn: "right", secondTurn: "right", segmentLengthsMeters: [63.75, 22.5, 63.75] };

export const demoFieldPolygon = [
  { x: 0, y: 0 },
  { x: 360, y: 0 },
  { x: 360, y: 56 },
  { x: 340, y: 80 },
  { x: 25, y: 80 },
  { x: 0, y: 60 }
];

export function createDemoTracks(): Track[] {
  return [
    createBTrack("demo-track-1", 1, { x: 25, y: 12 }, 0, leftLeft),
    createBTrack("demo-track-2", 2, { x: 208.75, y: 12 }, 180, rightRight),
    createBTrack("demo-track-3", 3, { x: 265, y: 12 }, 0, leftLeft),
    createBTrack("demo-track-4", 4, { x: 96, y: 49.5 }, 180, rightRight),
    createBTrack("demo-track-5", 5, { x: 145, y: 49.5 }, 0, leftLeft),
    createBTrack("demo-track-6", 6, { x: 328.75, y: 49.5 }, 180, rightRight)
  ];
}

export function createDemoProject(id = "demo-project"): ProjectSnapshot {
  const now = new Date().toISOString();
  const areaM2 = calculatePolygonArea(demoFieldPolygon);

  return {
    id,
    name: "Eksempelmark - 6 B-spor",
    club: "DcH Holbæk",
    eventName: "Træning",
    eventDate: now.slice(0, 10),
    description: "Demoprojekt til udvikling, test og sporlæggerark.",
    notes: "Marken er tegnet i lokale meterkoordinater; koordinaterne er ikke lat/lon.",
    requestedTrackCount: 6,
    edgeMarginMeters: 8,
    minimumTrackSpacingMeters: 15,
    field: {
      id: "demo-field",
      name: "Eksempelmark ved Tøderupvej",
      sourceType: "image",
      areaM2,
      areaHa: areaM2 / 10_000,
      polygon: demoFieldPolygon,
      perimeterMeters: calculatePolygonPerimeter(demoFieldPolygon),
      calibration: {
        method: "area",
        meterPerPixel: 1,
        knownAreaM2: areaM2,
        calculatedAreaM2: areaM2,
        deviationPercent: 0,
        warningDa:
          "Arealbaseret kalibrering er kun præcis, hvis billedet har ens målestok i begge retninger og ikke er perspektivforvrænget."
      }
    },
    restrictedAreas: [
      {
        id: "demo-obstacle-1",
        name: "Vandhul",
        type: "polygon",
        areaType: "vandhul",
        description: "Må ikke betrædes.",
        safetyDistanceMeters: 3,
        color: "#0b7285",
        active: true,
        polygon: [
          { x: 112, y: 38 },
          { x: 127, y: 38 },
          { x: 130, y: 48 },
          { x: 117, y: 53 },
          { x: 108, y: 46 }
        ]
      }
    ],
    template: dchBTrackTemplate,
    templates: dchTrackTemplates,
    tracks: createDemoTracks(),
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}
