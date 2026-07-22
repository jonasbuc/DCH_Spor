import { describe, expect, it } from "vitest";
import { createDemoProject } from "@/domain/demo-data";
import { dchATrackTemplate, dchBTrackTemplate, dchETrackTemplate } from "@/domain/rules/templates";
import { createBTrack, createTrackFromShape } from "@/domain/track/create-track";
import { validateProject, validateTrack } from "@/domain/validation/validation";
import type { Track } from "@/domain/types";
import { calibrateByDimensions, calibrateByDistance, calibrateByKnownArea } from "@/geometry/calibration";
import { createInnerUsablePolygon } from "@/geometry/buffers";
import { distanceBetweenTracks, nearestDistanceToBoundary, tracksIntersect } from "@/geometry/distances";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";
import { createMapReference, latLonToLocalMeters, localMetersToLatLon } from "@/geometry/map-projection";
import { calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import {
  calculateSegmentLengths,
  calculateTrackLength,
  calculateTurnAngles,
  coordinateAtDistance,
  doesTrackSelfIntersect
} from "@/geometry/polylines";
import { mirrorTrack, rotateTrack } from "@/geometry/transforms";
import { parseAreaInputToM2, parseDanishNumber, squareMetersToHectares, stepsToMeters } from "@/utils/locale";

const field = [
  { x: 0, y: 0 },
  { x: 220, y: 0 },
  { x: 220, y: 120 },
  { x: 0, y: 120 }
];

describe("danske tal og enheder", () => {
  it("fortolker dansk tusindtals- og decimalseparator", () => {
    expect(parseDanishNumber("28.310")).toBe(28310);
    expect(parseDanishNumber("2,831")).toBe(2.831);
  });

  it("omregner m², hektar, skridt og meter", () => {
    expect(squareMetersToHectares(28_310)).toBe(2.831);
    expect(parseAreaInputToM2("28.310 m²")).toBe(28_310);
    expect(parseAreaInputToM2("2,831 ha")).toBe(28_310);
    expect(stepsToMeters(200, 0.75)).toBe(150);
    expect(stepsToMeters(20, 0.75)).toBe(15);
    expect(stepsToMeters(30, 0.75)).toBe(22.5);
  });
});

describe("polygoner og kalibrering", () => {
  it("beregner polygonareal", () => {
    expect(calculatePolygonArea(field)).toBe(26_400);
  });

  it("kalibrerer efter afstand, areal og dimensioner", () => {
    expect(calibrateByDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 50).meterPerPixel).toBe(0.5);
    expect(calibrateByKnownArea(field, 26_400).meterPerPixel).toBe(1);
    expect(calibrateByDimensions(100, 50, 200, 100).meterPerPixel).toBe(2);
  });

  it("laver negativ buffer for rektangulær mark", () => {
    const inner = createInnerUsablePolygon(field, 8);
    expect(inner).toEqual([
      { x: 8, y: 8 },
      { x: 212, y: 8 },
      { x: 212, y: 112 },
      { x: 8, y: 112 }
    ]);
  });

  it("projekterer kortkoordinater til lokale meter og tilbage", () => {
    const reference = createMapReference({ centerLat: 55.6761, centerLon: 12.5683, zoom: 16 });
    const local = latLonToLocalMeters({ lat: 55.677, lon: 12.57 }, reference);
    const roundTrip = localMetersToLatLon(local, reference);
    expect(roundTrip.lat).toBeCloseTo(55.677, 5);
    expect(roundTrip.lon).toBeCloseTo(12.57, 5);
  });
});

describe("spor-geometri", () => {
  it("beregner segmenter, samlet længde og 90-graders knæk", () => {
    const track = createBTrack("track-1", 1, { x: 20, y: 20 }, 0);
    expect(calculateSegmentLengths(track.points)).toEqual([63.75, 22.5, 63.75]);
    expect(calculateTrackLength(track)).toBe(150);
    expect(calculateTurnAngles(track.points)[0]).toBeCloseTo(90);
    expect(calculateTurnAngles(track.points)[1]).toBeCloseTo(90);
  });

  it("roterer og spejlvender spor", () => {
    const track = createBTrack("track-1", 1, { x: 0, y: 0 }, 0);
    const rotated = rotateTrack(track, 90, { x: 0, y: 0 });
    expect(rotated.points[1].x).toBeCloseTo(0);
    expect(rotated.points[1].y).toBeCloseTo(63.75);
    const mirrored = mirrorTrack(track, "y");
    expect(mirrored.points[1].x).toBeCloseTo(-63.75);
  });

  it("måler afstand mellem spor", () => {
    const trackA = lineTrack("a", [
      { x: 0, y: 0 },
      { x: 30, y: 0 }
    ]);
    const trackB = lineTrack("b", [
      { x: 0, y: 14.9 },
      { x: 30, y: 14.9 }
    ]);
    const trackC = lineTrack("c", [
      { x: 0, y: 15 },
      { x: 30, y: 15 }
    ]);
    expect(distanceBetweenTracks(trackA, trackB)).toBeCloseTo(14.9);
    expect(distanceBetweenTracks(trackA, trackC)).toBeCloseTo(15);
  });

  it("måler kantafstand", () => {
    const track = createBTrack("track-1", 1, { x: 20, y: 20 }, 0);
    expect(nearestDistanceToBoundary(track.points, field)).toBeCloseTo(20);
  });

  it("finder selvkrydsning og objektposition langs polyline", () => {
    const crossing = lineTrack("crossing", [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 }
    ]);
    expect(doesTrackSelfIntersect(crossing)).toBe(true);
    expect(coordinateAtDistance(createBTrack("track-1", 1, { x: 0, y: 0 }, 0).points, 63.75)).toEqual({
      x: 63.75,
      y: 0
    });
  });

  it("kan oprette A-spor med spids vinkel", () => {
    const track = createTrackFromShape(
      "track-a",
      1,
      { x: 100, y: 100 },
      0,
      dchATrackTemplate,
      {
        segmentLengthsMeters: [120, 90, 90, 150],
        turnAnglesDegrees: [90, 90, 60],
        turnDirections: ["left", "right", "left"]
      },
      "A-spor"
    );
    expect(calculateTrackLength(track)).toBe(450);
    expect(calculateTurnAngles(track.points).map((angle) => Math.round(angle))).toEqual([90, 90, 60]);
  });
});

describe("validering og placering", () => {
  it("godkender demoprojektets seks B-spor", () => {
    const validation = validateProject(createDemoProject());
    expect(validation.valid).toBe(true);
  });

  it("afviser spor uden for marken", () => {
    const track = createBTrack("track-1", 1, { x: -20, y: 20 }, 0);
    const result = validateTrack(track, dchBTrackTemplate, {
      fieldPolygon: field,
      edgeMarginMeters: 0,
      otherTracks: []
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "OUTSIDE_FIELD")).toBe(true);
  });

  it("afviser 14,9 m sporafstand og accepterer 15 m", () => {
    const trackA = lineTrack("a", [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 50 },
      { x: 140, y: 50 }
    ]);
    const tooClose = lineTrack("b", [
      { x: 20, y: 64.9 },
      { x: 80, y: 64.9 },
      { x: 80, y: 94.9 },
      { x: 140, y: 94.9 }
    ]);
    const accepted = lineTrack("c", [
      { x: 20, y: 65 },
      { x: 80, y: 65 },
      { x: 80, y: 95 },
      { x: 140, y: 95 }
    ]);
    const crossing = lineTrack("cross-other", [
      { x: 20, y: 80 },
      { x: 80, y: 80 },
      { x: 80, y: 20 },
      { x: 140, y: 20 }
    ]);

    expect(
      validateTrack(trackA, dchBTrackTemplate, {
        fieldPolygon: field,
        edgeMarginMeters: 0,
        minimumTrackSpacingMeters: 15,
        otherTracks: [tooClose]
      }).errors.some((error) => error.code === "TRACK_SPACING")
    ).toBe(true);
    expect(
      validateTrack(trackA, dchBTrackTemplate, {
        fieldPolygon: field,
        edgeMarginMeters: 0,
        minimumTrackSpacingMeters: 15,
        otherTracks: [accepted]
      }).errors.some((error) => error.code === "TRACK_SPACING")
    ).toBe(false);
    expect(tracksIntersect(trackA, crossing)).toBe(true);
    expect(
      validateTrack(trackA, dchBTrackTemplate, {
        fieldPolygon: field,
        edgeMarginMeters: 0,
        minimumTrackSpacingMeters: 15,
        otherTracks: [crossing]
      }).errors.some((error) => error.code === "TRACK_INTERSECTION")
    ).toBe(true);
  });

  it("måler kantmargin mod hele sporsegmentet og ikke kun punkter", () => {
    const nearBoundaryMidSegment = lineTrack("near-boundary-mid", [
      { x: 20, y: 20 },
      { x: 110, y: 2 },
      { x: 200, y: 20 }
    ]);

    expect(nearestDistanceToBoundary(nearBoundaryMidSegment.points, field)).toBeLessThan(8);
    expect(
      validateTrack(nearBoundaryMidSegment, dchBTrackTemplate, {
        fieldPolygon: field,
        edgeMarginMeters: 8,
        otherTracks: []
      }).errors.some((error) => error.code === "EDGE_MARGIN")
    ).toBe(true);
  });

  it("afviser 80-graders knæk", () => {
    const track = lineTrack("bad-angle", [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 90.42, y: 79.09 },
      { x: 150, y: 79.09 }
    ]);
    const result = validateTrack(track, dchBTrackTemplate, {
      fieldPolygon: field,
      edgeMarginMeters: 0,
      otherTracks: []
    });
    expect(result.errors.some((error) => error.code === "TURN_ANGLE")).toBe(true);
  });

  it("godkender E-spor med fire vinkelrette og to spidse knæk", () => {
    const bigField = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 }
    ];
    const track = createTrackFromShape(
      "track-e",
      1,
      { x: 200, y: 200 },
      0,
      dchETrackTemplate,
      {
        segmentLengthsMeters: [120, 95, 95, 110, 95, 110, 125],
        turnAnglesDegrees: [90, 90, 90, 90, 45, 45],
        turnDirections: ["left", "right", "left", "right", "left", "right"]
      },
      "E-spor"
    );

    expect(
      validateTrack(track, dchETrackTemplate, {
        fieldPolygon: bigField,
        edgeMarginMeters: 0,
        otherTracks: []
      }).valid
    ).toBe(true);
  });

  it("afviser spor, der krydser forbudt område", () => {
    const track = createBTrack("track-1", 1, { x: 20, y: 20 }, 0);
    const result = validateTrack(track, dchBTrackTemplate, {
      fieldPolygon: field,
      edgeMarginMeters: 0,
      otherTracks: [],
      restrictedAreas: [
        {
          id: "restricted",
          name: "Krat",
          type: "polygon",
          areaType: "højt krat",
          safetyDistanceMeters: 0,
          color: "#d9480f",
          active: true,
          polygon: [
            { x: 70, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 35 },
            { x: 70, y: 35 }
          ]
        }
      ]
    });
    expect(result.errors.some((error) => error.code === "RESTRICTED_AREA")).toBe(true);
  });

  it("genererer reproducerbare kandidatplaceringer", () => {
    const project = createDemoProject();
    const result = autoPlaceTracks(project, {
      requestedTrackCount: 6,
      edgeMarginMeters: 8,
      minimumTrackSpacingMeters: 15,
      preferredDirectionDegrees: 0,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: true,
      sameShape: false,
      varySegmentLengths: true,
      seed: 123
    });
    expect(result.labelDa).toBe("Bedste fundne forslag");
    expect(result.placedTrackCount).toBe(6);
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
  });

  it("kan autoplacere 1 og 4 B-spor uden at falde tilbage til 0", () => {
    for (const requestedTrackCount of [1, 4]) {
      const result = autoPlaceTracks(createDemoProject(), {
        requestedTrackCount,
        edgeMarginMeters: 8,
        minimumTrackSpacingMeters: 15,
        preferredDirectionDegrees: 0,
        allowMirror: true,
        alternateStartDirections: true,
        placeInRows: true,
        sameShape: false,
        varySegmentLengths: true,
        seed: 123
      });

      expect(result.placedTrackCount).toBe(requestedTrackCount);
    }
  });

  it("respekterer ændret B-sporslængde ved autoplacering", () => {
    const longerBTemplate = {
      ...dchBTrackTemplate,
      lengthSteps: 267,
      lengthMeters: stepsToMeters(267, dchBTrackTemplate.stepLengthMeters),
      lengthToleranceMeters: 1.5
    };
    const project = {
      ...createDemoProject("longer-b"),
      template: longerBTemplate,
      templates: [longerBTemplate, dchATrackTemplate, dchETrackTemplate],
      tracks: []
    };
    const result = autoPlaceTracks(project, {
      requestedTrackCount: 4,
      edgeMarginMeters: 8,
      minimumTrackSpacingMeters: 15,
      preferredDirectionDegrees: 0,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: true,
      sameShape: false,
      varySegmentLengths: true,
      seed: 123
    });

    expect(result.placedTrackCount).toBe(4);
    expect(validateProject({ ...project, tracks: result.tracks }).valid).toBe(true);
    expect(result.tracks.every((track) => Math.abs(calculateTrackLength(track) - longerBTemplate.lengthMeters) < 0.001)).toBe(true);
  });

  it("kan autoplacere A- og E-spor intelligent på større marker", () => {
    const aField = [
      { x: 0, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 650 },
      { x: 0, y: 650 }
    ];
    const aFieldArea = calculatePolygonArea(aField);
    const baseAProject = createDemoProject("auto-a");
    const aProject = {
      ...baseAProject,
      template: dchATrackTemplate,
      templates: [dchBTrackTemplate, dchATrackTemplate, dchETrackTemplate],
      tracks: [],
      edgeMarginMeters: 10,
      minimumTrackSpacingMeters: dchATrackTemplate.minTrackSpacingMeters,
      field: {
        ...baseAProject.field,
        polygon: aField,
        areaM2: aFieldArea,
        areaHa: aFieldArea / 10_000,
        perimeterMeters: calculatePolygonPerimeter(aField)
      },
      restrictedAreas: []
    };
    const aResult = autoPlaceTracks(aProject, {
      requestedTrackCount: 10,
      edgeMarginMeters: 10,
      minimumTrackSpacingMeters: dchATrackTemplate.minTrackSpacingMeters,
      preferredDirectionDegrees: 20,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: false,
      sameShape: false,
      varySegmentLengths: true,
      seed: 777
    });

    expect(aResult.placedTrackCount).toBe(10);
    expect(validateProject({ ...aProject, tracks: aResult.tracks }).valid).toBe(true);

    const eField = [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 1200, y: 900 },
      { x: 0, y: 900 }
    ];
    const eFieldArea = calculatePolygonArea(eField);
    const baseEProject = createDemoProject("auto-e");
    const eProject = {
      ...baseEProject,
      template: dchETrackTemplate,
      templates: [dchBTrackTemplate, dchATrackTemplate, dchETrackTemplate],
      tracks: [],
      edgeMarginMeters: 10,
      minimumTrackSpacingMeters: dchETrackTemplate.minTrackSpacingMeters,
      field: {
        ...baseEProject.field,
        polygon: eField,
        areaM2: eFieldArea,
        areaHa: eFieldArea / 10_000,
        perimeterMeters: calculatePolygonPerimeter(eField)
      },
      restrictedAreas: []
    };
    const eResult = autoPlaceTracks(eProject, {
      requestedTrackCount: 6,
      edgeMarginMeters: 10,
      minimumTrackSpacingMeters: dchETrackTemplate.minTrackSpacingMeters,
      preferredDirectionDegrees: 25,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: false,
      sameShape: false,
      varySegmentLengths: true,
      seed: 777
    });

    expect(eResult.placedTrackCount).toBe(6);
    expect(validateProject({ ...eProject, tracks: eResult.tracks }).valid).toBe(true);
  });

  it("kan placere nye spor uden om eksisterende faste spor", () => {
    const project = createDemoProject("fixed-track");
    const fixedTrack = project.tracks[0];
    const result = autoPlaceTracks({ ...project, tracks: [fixedTrack] }, {
      requestedTrackCount: 1,
      fixedTracks: [fixedTrack],
      edgeMarginMeters: 8,
      minimumTrackSpacingMeters: 15,
      preferredDirectionDegrees: 0,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: true,
      sameShape: false,
      varySegmentLengths: true,
      seed: 123
    });

    expect(result.placedTrackCount).toBe(1);
    expect(result.tracks).toHaveLength(2);
    expect(validateProject({ ...project, tracks: result.tracks }).valid).toBe(true);
  });
});

function lineTrack(id: string, points: Track["points"]): Track {
  return {
    id,
    displayNo: 1,
    name: id,
    color: "#000",
    points,
    lengthSteps: 200,
    stepLengthMeters: 0.75,
    lengthMeters: calculateTrackLength({ points }),
    rotationDegrees: 0,
    lockedLength: false,
    lockedAngles: false,
    objects: []
  };
}
