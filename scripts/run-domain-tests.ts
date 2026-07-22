import assert from "node:assert/strict";
import { createDemoProject } from "@/domain/demo-data";
import { dchATrackTemplate, dchBTrackTemplate, dchETrackTemplate } from "@/domain/rules/templates";
import { createBTrack, createTrackFromShape } from "@/domain/track/create-track";
import type { Track } from "@/domain/types";
import { validateProject, validateTrack } from "@/domain/validation/validation";
import { calibrateByDimensions, calibrateByDistance, calibrateByKnownArea } from "@/geometry/calibration";
import { createInnerUsablePolygon } from "@/geometry/buffers";
import { distanceBetweenTracks, nearestDistanceToBoundary, tracksIntersect } from "@/geometry/distances";
import { createMapReference, latLonToLocalMeters, localMetersToLatLon } from "@/geometry/map-projection";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";
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

const tests: { name: string; run: () => void }[] = [
  {
    name: "danske tal og enheder",
    run: () => {
      assert.equal(parseDanishNumber("28.310"), 28310);
      assert.equal(parseDanishNumber("2,831"), 2.831);
      assert.equal(squareMetersToHectares(28_310), 2.831);
      assert.equal(parseAreaInputToM2("28.310 m²"), 28_310);
      assert.equal(parseAreaInputToM2("2,831 ha"), 28_310);
      assert.equal(stepsToMeters(200, 0.75), 150);
    }
  },
  {
    name: "polygoner, kalibrering og kortprojektion",
    run: () => {
      assert.equal(calculatePolygonArea(field), 26_400);
      assert.equal(calibrateByDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 50).meterPerPixel, 0.5);
      assert.equal(calibrateByKnownArea(field, 26_400).meterPerPixel, 1);
      assert.equal(calibrateByDimensions(100, 50, 200, 100).meterPerPixel, 2);
      assert.deepEqual(createInnerUsablePolygon(field, 8), [
        { x: 8, y: 8 },
        { x: 212, y: 8 },
        { x: 212, y: 112 },
        { x: 8, y: 112 }
      ]);
      const reference = createMapReference({ centerLat: 55.6761, centerLon: 12.5683, zoom: 16 });
      const local = latLonToLocalMeters({ lat: 55.677, lon: 12.57 }, reference);
      const roundTrip = localMetersToLatLon(local, reference);
      assert.ok(Math.abs(roundTrip.lat - 55.677) < 0.00001);
      assert.ok(Math.abs(roundTrip.lon - 12.57) < 0.00001);
    }
  },
  {
    name: "spor-geometri",
    run: () => {
      const track = createBTrack("track-1", 1, { x: 20, y: 20 }, 0);
      assert.deepEqual(calculateSegmentLengths(track.points), [63.75, 22.5, 63.75]);
      assert.equal(calculateTrackLength(track), 150);
      assert.ok(Math.abs(calculateTurnAngles(track.points)[0] - 90) < 0.00001);
      const rotated = rotateTrack(createBTrack("track-rotate", 1, { x: 0, y: 0 }, 0), 90, { x: 0, y: 0 });
      assert.ok(Math.abs(rotated.points[1].x) < 0.00001);
      assert.ok(Math.abs(rotated.points[1].y - 63.75) < 0.00001);
      assert.ok(Math.abs(mirrorTrack(createBTrack("track-mirror", 1, { x: 0, y: 0 }, 0), "y").points[1].x + 63.75) < 0.00001);
      assert.equal(
        doesTrackSelfIntersect(
          lineTrack("crossing", [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 10, y: 0 }
          ])
        ),
        true
      );
      assert.deepEqual(coordinateAtDistance(createBTrack("track-distance", 1, { x: 0, y: 0 }, 0).points, 63.75), {
        x: 63.75,
        y: 0
      });
      const aTrack = createTrackFromShape(
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
      assert.equal(calculateTrackLength(aTrack), 450);
      assert.deepEqual(calculateTurnAngles(aTrack.points).map((angle) => Math.round(angle)), [90, 90, 60]);
    }
  },
  {
    name: "validering og automatisk placering",
    run: () => {
      assert.equal(validateProject(createDemoProject()).valid, true);
      assert.equal(
        validateTrack(createBTrack("track-outside", 1, { x: -20, y: 20 }, 0), dchBTrackTemplate, {
          fieldPolygon: field,
          edgeMarginMeters: 0,
          otherTracks: []
        }).errors.some((error) => error.code === "OUTSIDE_FIELD"),
        true
      );
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
      const nearBoundaryMidSegment = lineTrack("near-boundary-mid", [
        { x: 20, y: 20 },
        { x: 110, y: 2 },
        { x: 200, y: 20 }
      ]);
      assert.ok(distanceBetweenTracks(trackA, tooClose) < 15);
      assert.ok(distanceBetweenTracks(trackA, accepted) >= 15);
      assert.equal(tracksIntersect(trackA, crossing), true);
      assert.equal(
        validateTrack(trackA, dchBTrackTemplate, {
          fieldPolygon: field,
          edgeMarginMeters: 0,
          minimumTrackSpacingMeters: 15,
          otherTracks: [crossing]
        }).errors.some((error) => error.code === "TRACK_INTERSECTION"),
        true
      );
      assert.equal(nearestDistanceToBoundary(createBTrack("track-boundary", 1, { x: 20, y: 20 }, 0).points, field), 20);
      assert.ok(nearestDistanceToBoundary(nearBoundaryMidSegment.points, field) < 8);
      assert.equal(
        validateTrack(nearBoundaryMidSegment, dchBTrackTemplate, {
          fieldPolygon: field,
          edgeMarginMeters: 8,
          otherTracks: []
        }).errors.some((error) => error.code === "EDGE_MARGIN"),
        true
      );
      const bigField = [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 1000 },
        { x: 0, y: 1000 }
      ];
      const eTrack = createTrackFromShape(
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
      assert.equal(
        validateTrack(eTrack, dchETrackTemplate, {
          fieldPolygon: bigField,
          edgeMarginMeters: 0,
          otherTracks: []
        }).valid,
        true
      );
      const placement = autoPlaceTracks(createDemoProject(), {
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
      assert.equal(placement.labelDa, "Bedste fundne forslag");
      assert.equal(placement.placedTrackCount, 6);
      assert.ok(placement.candidatesEvaluated > 0);

      const oneTrackPlacement = autoPlaceTracks(createDemoProject(), {
        requestedTrackCount: 1,
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
      assert.equal(oneTrackPlacement.placedTrackCount, 1);

      const fourTrackPlacement = autoPlaceTracks(createDemoProject(), {
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
      assert.equal(fourTrackPlacement.placedTrackCount, 4);

      const longerBTemplate = {
        ...dchBTrackTemplate,
        lengthSteps: 267,
        lengthMeters: stepsToMeters(267, dchBTrackTemplate.stepLengthMeters),
        lengthToleranceMeters: 1.5
      };
      const longerBProject = {
        ...createDemoProject("longer-b"),
        template: longerBTemplate,
        templates: [longerBTemplate, dchATrackTemplate, dchETrackTemplate],
        tracks: []
      };
      const longerBPlacement = autoPlaceTracks(longerBProject, {
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
      assert.equal(longerBPlacement.placedTrackCount, 4);
      assert.equal(validateProject({ ...longerBProject, tracks: longerBPlacement.tracks }).valid, true);
      assert.ok(longerBPlacement.tracks.every((track) => Math.abs(calculateTrackLength(track) - longerBTemplate.lengthMeters) < 0.001));

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
      const aPlacement = autoPlaceTracks(aProject, {
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
      assert.equal(aPlacement.placedTrackCount, 10);
      assert.equal(validateProject({ ...aProject, tracks: aPlacement.tracks }).valid, true);

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
      const ePlacement = autoPlaceTracks(eProject, {
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
      assert.equal(ePlacement.placedTrackCount, 6);
      assert.equal(validateProject({ ...eProject, tracks: ePlacement.tracks }).valid, true);

      const projectWithFixedTrack = createDemoProject("fixed-track");
      const fixedTrack = projectWithFixedTrack.tracks[0];
      const addOnePlacement = autoPlaceTracks({ ...projectWithFixedTrack, tracks: [fixedTrack] }, {
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
      assert.equal(addOnePlacement.placedTrackCount, 1);
      assert.equal(addOnePlacement.tracks.length, 2);
      assert.equal(validateProject({ ...projectWithFixedTrack, tracks: addOnePlacement.tracks }).valid, true);
    }
  }
];

let failures = 0;
for (const test of tests) {
  try {
    test.run();
    process.stdout.write(`ok - ${test.name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`not ok - ${test.name}\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
}

process.exit(failures === 0 ? 0 : 1);

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
