import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "./preview.css";
import type {
  Coordinate,
  FieldBackgroundImage,
  PlacementOptions,
  ProjectSnapshot,
  ProjectValidationResult,
  Track,
  TrackTemplateRules,
  TurnDirection,
  ValidationMessage
} from "@/domain/types";
import { createDemoProject } from "@/domain/demo-data";
import { dchTrackTemplates } from "@/domain/rules/templates";
import { createTrackFromShape } from "@/domain/track/create-track";
import { validateProject } from "@/domain/validation/validation";
import { distanceBetweenSegments } from "@/geometry/distances";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";
import { polygonBounds, calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import {
  calculateSegmentLengths,
  calculateTrackLength,
  calculateTurnAngles,
  coordinateAtDistance,
  distance,
  segmentsIntersect
} from "@/geometry/polylines";
import { mirrorTrack, rotatePoint, rotateTrack, translateTrack } from "@/geometry/transforms";
import { createMapReference, latLonToLocalMeters } from "@/geometry/map-projection";
import { projectToGeoJson, projectToSvg } from "@/domain/export/exporters";
import { formatHectares, formatMeters, formatSquareMeters, metersToSteps, parseAreaInputToM2 } from "@/utils/locale";

type GeocodeResult = { label: string; lat: number; lon: number };
type SnapshotVersion = { id: string; label: string; snapshot: ProjectSnapshot; createdAt: string };
type ViewBoxState = { x: number; y: number; width: number; height: number };
type DownloadFormat = "svg" | "geojson" | "json" | "sheet-html" | "sheet-md" | "sheet-pdf";
type FocusTarget = { position: Coordinate; label: string; trackId?: string } | null;
type RuleStatus = "ok" | "warning" | "error";
type RuleCheck = {
  id: string;
  label: string;
  status: RuleStatus;
  value: string;
  detail: string;
  position?: Coordinate;
  trackId?: string;
};
type PlacementReport = {
  result: ReturnType<typeof autoPlaceTracks>;
  mode: "requested" | "maximum" | "mixed";
  directionDegrees: number;
  triedDirections: number[];
  summary: string;
};
type PlacementInsight = {
  trackId: string;
  name: string;
  status: RuleStatus;
  position: Coordinate;
  boundaryDistanceMeters: number;
  boundaryRequiredMeters: number;
  nearestTrackDistanceMeters?: number;
  nearestTrackName?: string;
  spacingRequiredMeters: number;
  lengthMeters: number;
  issueCount: number;
};
type CapacityEstimate = {
  code: string;
  label: string;
  suggestedTrackCount: number;
  optimisticTrackCount: number;
  usableAreaM2: number;
  areaPerTrackM2: number;
  spacingMeters: number;
  lengthMeters: number;
};
type DistanceGuide = {
  id: string;
  label: string;
  from: Coordinate;
  to: Coordinate;
  distanceMeters: number;
  requiredMeters: number;
  status: RuleStatus;
  trackId: string;
  relatedTrackId?: string;
};
type IntersectionGuide = {
  id: string;
  label: string;
  position: Coordinate;
  trackId: string;
  relatedTrackId: string;
};
type RuleGuideOverlay = {
  guideTrackIds: string[];
  edgeGuides: DistanceGuide[];
  trackGuides: DistanceGuide[];
  intersections: IntersectionGuide[];
  errorCount: number;
  warningCount: number;
};
type TrackProfile = {
  code: string;
  label: string;
  prefix: string;
  template: TrackTemplateRules;
  segmentLengthsMeters: number[];
  turnAnglesDegrees: number[];
  turnDirections: TurnDirection[];
};
type EditorDragState =
  | { type: "track"; trackId: string; last: Coordinate }
  | { type: "pan"; lastClientX: number; lastClientY: number }
  | { type: "rotate"; trackIds: string[]; origin: Coordinate; startAngleDegrees: number; initialTracks: Track[] }
  | { type: "object"; trackId: string; objectId: string }
  | null;

const trackProfiles: TrackProfile[] = [
  {
    code: "DCH_B",
    label: "B-spor",
    prefix: "B-spor",
    template: dchTrackTemplates.find((template) => template.code === "DCH_B") ?? dchTrackTemplates[0],
    segmentLengthsMeters: [63.75, 22.5, 63.75],
    turnAnglesDegrees: [90, 90],
    turnDirections: ["left", "left"]
  },
  {
    code: "DCH_A",
    label: "A-spor",
    prefix: "A-spor",
    template: dchTrackTemplates.find((template) => template.code === "DCH_A") ?? dchTrackTemplates[0],
    segmentLengthsMeters: [120, 90, 90, 150],
    turnAnglesDegrees: [90, 90, 60],
    turnDirections: ["left", "right", "left"]
  },
  {
    code: "DCH_E",
    label: "E-spor / Elite",
    prefix: "E-spor",
    template: dchTrackTemplates.find((template) => template.code === "DCH_E") ?? dchTrackTemplates[0],
    segmentLengthsMeters: [120, 95, 95, 110, 95, 110, 125],
    turnAnglesDegrees: [90, 90, 90, 90, 45, 45],
    turnDirections: ["left", "right", "left", "right", "left", "right"]
  }
];

const root = createRoot(document.getElementById("root") ?? document.body);
root.render(<PreviewApp />);

function PreviewApp() {
  const [project, setProject] = useState<ProjectSnapshot>(() => ({ ...createDemoProject("preview-project"), templates: dchTrackTemplates }));
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>(["demo-track-1"]);
  const [dragging, setDragging] = useState<EditorDragState>(null);
  const [stage, setStage] = useState("Klar");
  const [saveStatus, setSaveStatus] = useState("Gemt");
  const [mapOpen, setMapOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<SnapshotVersion[]>(() => [
    { id: "initial", label: "Startsnapshot", snapshot: createDemoProject("preview-project"), createdAt: new Date().toISOString() }
  ]);
  const [tool, setTool] = useState("select");
  const [polygonInput, setPolygonInput] = useState(() => formatPolygonInput(createDemoProject("preview-project").field.polygon));
  const [knownAreaInput, setKnownAreaInput] = useState("");
  const [polygonStatus, setPolygonStatus] = useState("Polygonen kan indsættes som koordinater, JSON eller GeoJSON.");
  const [rotationStepDegrees, setRotationStepDegrees] = useState(5);
  const [fieldRotationStepDegrees, setFieldRotationStepDegrees] = useState(5);
  const [rotationNudgeDegrees, setRotationNudgeDegrees] = useState(2.5);
  const [autoDirectionDegrees, setAutoDirectionDegrees] = useState(0);
  const [autoKeepExisting, setAutoKeepExisting] = useState(false);
  const [mixedCounts, setMixedCounts] = useState<Record<string, number>>({ DCH_B: 2, DCH_A: 0, DCH_E: 0 });
  const [activeTemplateCode, setActiveTemplateCode] = useState("DCH_B");
  const [viewBox, setViewBox] = useState<ViewBoxState>(() => viewBoxForProject(createDemoProject("preview-project")));
  const [showRuleGuides, setShowRuleGuides] = useState(false);
  const [showPlacementInsights, setShowPlacementInsights] = useState(false);
  const [showIssueLabels, setShowIssueLabels] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [lastPlacementReport, setLastPlacementReport] = useState<PlacementReport | null>(null);
  const [measurePoints, setMeasurePoints] = useState<Coordinate[]>([]);
  const [measureCursor, setMeasureCursor] = useState<Coordinate | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const requestedTrackCountRef = useRef<HTMLInputElement | null>(null);

  const validation = useMemo(() => validateProject(project), [project]);
  const messages = useMemo(() => [...validation.errors, ...validation.warnings], [validation]);
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackIds[selectedTrackIds.length - 1]) ?? project.tracks[0];
  const activeProfile = resolveTrackProfile(activeTemplateCode, project);
  const capacityEstimates = useMemo(() => estimateTrackCapacities(project), [project]);
  const activeCapacityEstimate = capacityEstimates.find((estimate) => estimate.code === activeTemplateCode) ?? capacityEstimates[0];
  const suggestedTrackCount = activeCapacityEstimate?.suggestedTrackCount ?? estimateTrackCapacity(project, activeProfile.template);
  const fieldAngleDegrees = fieldPrimaryAngle(project.field.polygon);
  const selectedTrackRuleChecks = useMemo(
    () => (selectedTrack ? buildTrackRuleChecks(project, selectedTrack, validation) : []),
    [project, selectedTrack, validation]
  );
  const ruleGuideOverlay = useMemo(
    () => buildRuleGuideOverlay(project, selectedTrackIds, validation),
    [project, selectedTrackIds, validation]
  );
  const placementInsights = useMemo(
    () => (lastPlacementReport ? buildPlacementInsights(project, validation, lastPlacementReport) : []),
    [lastPlacementReport, project, validation]
  );
  const activeMeasurement = useMemo(() => {
    const start = measurePoints[0];
    const end = measurePoints[1] ?? measureCursor;
    return start && end ? { start, end, distanceMeters: distance(start, end) } : null;
  }, [measureCursor, measurePoints]);

  function commit(next: ProjectSnapshot, text = "Ændring gemt i preview-state") {
    setProject({ ...next, templates: next.templates ?? dchTrackTemplates, updatedAt: new Date().toISOString(), version: next.version + 1 });
    setSaveStatus("Ikke gemt");
    setStage(text);
    window.setTimeout(() => setSaveStatus("Gemt"), 450);
  }

  function updateProjectMeta(patch: Partial<Pick<ProjectSnapshot, "name" | "club" | "eventName" | "notes">>) {
    commit({ ...project, ...patch }, "Projektmetadata ændret");
  }

  function toWorld(event: { clientX: number; clientY: number }): Coordinate {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function selectTrack(trackId: string, additive = false) {
    setSelectedObjectId(null);
    setSelectedTrackIds((current) => {
      if (!additive) return [trackId];
      return current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId];
    });
  }

  function selectedIds(): string[] {
    return selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrack ? [selectedTrack.id] : [];
  }

  function transformSelected(transform: (track: Track) => Track, text: string) {
    const ids = selectedIds();
    commit(
      {
        ...project,
        tracks: project.tracks.map((track) => (ids.includes(track.id) ? transform(track) : track))
      },
      text
    );
  }

  function rotateSelectedBy(angleDegrees: number) {
    transformSelected((track) => rotateTrack(track, angleDegrees, trackCenter(track)), `Markerede spor roteret ${angleDegrees.toFixed(1)}°`);
  }

  function moveSelectedBy(dx: number, dy: number) {
    transformSelected((track) => translateTrack(track, dx, dy), `Markerede spor flyttet ${formatMeters(Math.hypot(dx, dy), 1)}`);
  }

  function startRotationDrag(event: React.PointerEvent<SVGCircleElement>, trackId: string) {
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    const trackIds = selectedTrackIds.includes(trackId) ? selectedIds() : [trackId];
    const initialTracks = project.tracks.filter((track) => trackIds.includes(track.id));

    if (initialTracks.length === 0) {
      return;
    }

    const origin = centerOfTracks(initialTracks);
    setSelectedTrackIds(trackIds);
    setDragging({
      type: "rotate",
      trackIds,
      origin,
      startAngleDegrees: angleFrom(origin, toWorld(event)),
      initialTracks
    });
    setStage(`${trackIds.length} spor klar til rotation`);
  }

  function startObjectDrag(event: React.PointerEvent<SVGGElement>, trackId: string, objectId: string) {
    if (tool === "measure" || tool === "pan") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelectedTrackIds([trackId]);
    setSelectedObjectId(objectId);
    setDragging({ type: "object", trackId, objectId });
    setStage("Træk genstanden langs sporet");
  }

  function updateObjectDistance(trackId: string, objectId: string, distanceMeters: number, text = "Genstand flyttet") {
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    const clampedDistance = Math.max(0, Math.min(calculateTrackLength(track ?? { points: [] }), distanceMeters));

    commit(
      {
        ...project,
        tracks: project.tracks.map((candidate) =>
          candidate.id === trackId
            ? {
                ...candidate,
                objects: candidate.objects.map((object) =>
                  object.id === objectId ? { ...object, distanceAlongTrackMeters: clampedDistance } : object
                )
              }
            : candidate
        )
      },
      text
    );
    setSelectedObjectId(objectId);
  }

  function addTrack() {
    const bounds = polygonBounds(project.field.polygon);
    const displayNo = project.tracks.length + 1;
    const track = createTrackFromShape(
      `preview-track-${crypto.randomUUID()}`,
      displayNo,
      { x: bounds.minX + 18, y: bounds.minY + 18 },
      0,
      activeProfile.template,
      activeProfile,
      activeProfile.prefix
    );
    commit({ ...project, tracks: [...project.tracks, track] }, `${activeProfile.label} tilføjet`);
    setSelectedTrackIds([track.id]);
  }

  function deleteSelected() {
    const ids = selectedIds();
    if (ids.length === 0) return;
    const tracks = project.tracks
      .filter((track) => !ids.includes(track.id))
      .map((track, index) => ({ ...track, displayNo: index + 1, name: renameTrack(track, index + 1) }));
    commit({ ...project, tracks }, "Markerede spor slettet");
    setSelectedTrackIds(tracks[0] ? [tracks[0].id] : []);
  }

  function duplicateSelected() {
    const ids = selectedIds();
    const sources = project.tracks.filter((track) => ids.includes(track.id));
    const copies = sources.map((track, index) => {
      const displayNo = project.tracks.length + index + 1;
      return translateTrack(
        {
          ...track,
          id: `preview-track-${crypto.randomUUID()}`,
          displayNo,
          name: renameTrack(track, displayNo),
          objects: track.objects.map((object) => ({ ...object, id: `preview-object-${crypto.randomUUID()}` }))
        },
        12,
        12
      );
    });
    commit({ ...project, tracks: [...project.tracks, ...copies] }, "Markerede spor duplikeret");
    setSelectedTrackIds(copies.map((track) => track.id));
  }

  function createPlacementOptions(
    requestedTrackCount: number,
    fixedTracks: Track[],
    directionDegrees: number,
    template: TrackTemplateRules
  ): PlacementOptions {
    return {
      requestedTrackCount,
      fixedTracks,
      edgeMarginMeters: project.edgeMarginMeters,
      minimumTrackSpacingMeters: Math.max(project.minimumTrackSpacingMeters, template.minTrackSpacingMeters),
      preferredDirectionDegrees: directionDegrees,
      allowMirror: true,
      alternateStartDirections: true,
      placeInRows: true,
      sameShape: false,
      varySegmentLengths: true,
      seed: 42
    };
  }

  function findBestPlacement(
    placementProject: ProjectSnapshot,
    requestedTrackCount: number,
    fixedTracks: Track[],
    mode: PlacementReport["mode"]
  ): PlacementReport {
    const directions = uniqueDirections([autoDirectionDegrees, fieldAngleDegrees, 0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]);
    const attempts = directions.map((directionDegrees) => {
      const result = autoPlaceTracks(placementProject, createPlacementOptions(requestedTrackCount, fixedTracks, directionDegrees, placementProject.template));
      return { result, directionDegrees };
    });
    const best = attempts.sort((a, b) => {
      if (b.result.placedTrackCount !== a.result.placedTrackCount) {
        return b.result.placedTrackCount - a.result.placedTrackCount;
      }
      return b.result.score - a.result.score;
    })[0];
    const rejectedSummary = summarizeRejectedReasons(best.result.rejectedReasons);

    return {
      result: { ...best.result, tracks: relabelTracks(best.result.tracks) },
      mode,
      directionDegrees: best.directionDegrees,
      triedDirections: directions,
      summary: rejectedSummary || "Alle valgte spor kunne placeres uden regelbrud."
    };
  }

  function applyPlacementReport(placementProject: ProjectSnapshot, report: PlacementReport, text: string) {
    setLastPlacementReport(report);
    setShowPlacementInsights(true);
    commit({ ...placementProject, tracks: report.result.tracks }, text);
    const firstNewTrack = report.result.tracks[autoKeepExisting ? project.tracks.length : 0] ?? report.result.tracks[0];
    setSelectedTrackIds(firstNewTrack ? [firstNewTrack.id] : []);
  }

  function runAutoPlacement(mode: "requested" | "maximum" = "requested") {
    const requestedTrackCount =
      mode === "maximum" ? 1000 : normalizeTrackCount(Number(requestedTrackCountRef.current?.value ?? project.requestedTrackCount));
    const fixedTracks = autoKeepExisting ? project.tracks : [];
    const placementProject = withActiveTemplate({ ...project, requestedTrackCount }, activeProfile.template);
    setStage(mode === "maximum" ? "Finder maks antal lovlige spor ..." : "Automatisk placering prøver flere retninger ...");
    window.setTimeout(() => {
      const report = findBestPlacement(placementProject, requestedTrackCount, fixedTracks, mode);
      const placedText =
        mode === "maximum"
          ? `${report.result.placedTrackCount} nye spor fundet som maks`
          : `${report.result.placedTrackCount}/${report.result.requestedTrackCount} nye spor placeret`;
      applyPlacementReport(placementProject, report, `${placedText} · retning ${formatDegrees(report.directionDegrees)}`);
    }, 80);
  }

  function runMixedPlacement() {
    const entries = trackProfiles
      .map((profile) => ({ profile, count: normalizeOptionalTrackCount(Number(mixedCounts[profile.code] ?? 0)) }))
      .filter((entry) => entry.count > 0);

    if (entries.length === 0) {
      setStage("Vælg mindst én B/A/E-type til mix.");
      return;
    }

    setStage("Autoplacerer B/A/E-mix ...");
    window.setTimeout(() => {
      let placed = autoKeepExisting ? relabelTracks(project.tracks) : [];
      const reports: string[] = [];
      let nextProject = { ...project, tracks: placed, templates: project.templates ?? dchTrackTemplates };

      entries.forEach(({ profile, count }) => {
        const resolvedProfile = resolveTrackProfile(profile.code, nextProject);
        const placementProject = withActiveTemplate({ ...nextProject, requestedTrackCount: count }, resolvedProfile.template);
        const report = findBestPlacement(placementProject, count, placed, "mixed");
        placed = relabelTracks(report.result.tracks);
        nextProject = { ...placementProject, tracks: placed };
        reports.push(`${resolvedProfile.label}: ${report.result.placedTrackCount}/${count}`);
      });

      const finalReport: PlacementReport = {
        result: {
          labelDa: "Bedste fundne forslag",
          tracks: placed,
          requestedTrackCount: entries.reduce((sum, entry) => sum + entry.count, 0),
          placedTrackCount: placed.length - (autoKeepExisting ? project.tracks.length : 0),
          durationMs: 1,
          score: placed.length,
          candidatesEvaluated: 0,
          rejectedReasons: {}
        },
        mode: "mixed",
        directionDegrees: autoDirectionDegrees,
        triedDirections: [],
        summary: reports.join(" · ")
      };
      setLastPlacementReport(finalReport);
      commit({ ...nextProject, tracks: placed }, `Mix placeret: ${reports.join(" · ")}`);
      setSelectedTrackIds(placed[0] ? [placed[0].id] : []);
    }, 80);
  }

  function createCrossingExample() {
    if (project.tracks.length < 2) return;
    const first = project.tracks[0];
    const second = {
      ...project.tracks[1],
      points: [
        { x: first.points[0].x + 10, y: first.points[0].y + 58 },
        { x: first.points[1].x - 5, y: first.points[1].y + 58 },
        { x: first.points[1].x - 5, y: first.points[1].y - 8 },
        { x: first.points[2].x + 55, y: first.points[2].y - 8 }
      ]
    };
    commit({ ...project, tracks: project.tracks.map((track, index) => (index === 1 ? second : track)) }, "Testfejl: spor krydser hinanden");
    setSelectedTrackIds([first.id, second.id]);
  }

  function createBoundaryExample() {
    if (!selectedTrack) return;
    const moved = {
      ...selectedTrack,
      points: [
        { x: 20, y: 20 },
        { x: 110, y: 2 },
        { x: 200, y: 20 },
        { x: 220, y: 50 }
      ]
    };
    commit(
      {
        ...project,
        edgeMarginMeters: 8,
        tracks: project.tracks.map((track) => (track.id === selectedTrack.id ? moved : track))
      },
      "Testfejl: spor for tæt på skel"
    );
  }

  function focusRule(check: RuleCheck) {
    if (!check.position) {
      setStage(check.detail);
      return;
    }

    setShowRuleGuides(true);
    if (check.trackId) {
      setSelectedTrackIds([check.trackId]);
    }
    setFocusTarget({ position: check.position, label: check.label, trackId: check.trackId });
    const size = Math.max(70, Math.min(viewBox.width, viewBox.height) * 0.45);
    setViewBox({ x: check.position.x - size / 2, y: check.position.y - size / 2, width: size, height: size });
    setStage(check.detail);
  }

  function focusGuide(guide: DistanceGuide | IntersectionGuide) {
    const position = "position" in guide ? guide.position : midpoint(guide.from, guide.to);
    const size = Math.max(70, Math.min(viewBox.width, viewBox.height) * 0.5);
    setShowRuleGuides(true);
    setSelectedTrackIds([guide.trackId]);
    setFocusTarget({ position, label: guide.label, trackId: guide.trackId });
    setViewBox({ x: position.x - size / 2, y: position.y - size / 2, width: size, height: size });
    setStage(guide.label);
  }

  function focusTrack(track: Track) {
    const center = trackCenter(track);
    setSelectedTrackIds([track.id]);
    setFocusTarget({ position: center, label: track.name, trackId: track.id });
    setViewBox(viewBoxForPoints(track.points, 36));
    setStage(`${track.name} markeret`);
  }

  function rotateSelectedByNudge() {
    rotateSelectedBy(rotationNudgeDegrees);
  }

  function alignSelectedToField() {
    const targetDegrees = fieldPrimaryAngle(project.field.polygon);
    transformSelected((track) => rotateTrack(track, signedAngleDelta(track.rotationDegrees, targetDegrees), trackCenter(track)), `Markerede spor rettet til markretning ${formatDegrees(targetDegrees)}`);
  }

  function saveFieldVariant() {
    setVersions((current) => [
      {
        id: crypto.randomUUID(),
        label: `Markvariant ${current.length + 1}`,
        snapshot: project,
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
    setStage("Markvariant gemt i versioner");
  }

  async function uploadBackground(file?: File) {
    if (!file) return;
    const dimensions = await readImageDimensions(file);
    const bounds = polygonBounds(project.field.polygon);
    const url = URL.createObjectURL(file);
    const backgroundImage: FieldBackgroundImage = {
      originalName: file.name,
      mimeType: file.type,
      byteSize: file.size,
      storageKey: `preview-${file.name}`,
      url,
      widthPixels: dimensions.width,
      heightPixels: dimensions.height,
      x: bounds.minX,
      y: bounds.minY,
      widthMeters: bounds.width || dimensions.width,
      heightMeters: bounds.height || dimensions.height,
      rotationDegrees: 0,
      opacity: 0.48,
      crop: { topPercent: 0, rightPercent: 0, bottomPercent: 0, leftPercent: 0 }
    };
    commit({ ...project, field: { ...project.field, backgroundImage } }, "Billedlag indlæst");
  }

  function rotateBackground() {
    const background = project.field.backgroundImage;
    if (!background) return;
    commit(
      {
        ...project,
        field: {
          ...project.field,
          backgroundImage: { ...background, rotationDegrees: (background.rotationDegrees + 15) % 360 }
        }
      },
      "Billedlag roteret"
    );
  }

  function cropBackground() {
    const background = project.field.backgroundImage;
    if (!background) return;
    commit(
      {
        ...project,
        field: {
          ...project.field,
          backgroundImage: {
            ...background,
            crop: {
              ...background.crop,
              leftPercent: Math.min(35, background.crop.leftPercent + 5),
              rightPercent: Math.min(35, background.crop.rightPercent + 5)
            }
          }
        }
      },
      "Billedlag croppet"
    );
  }

  function rotateFieldBy(angleDegrees: number) {
    const next = rotateProjectField(project, angleDegrees);
    commit(next, `Mark roteret ${angleDegrees.toFixed(1)}°`);
    setPolygonInput(formatPolygonInput(next.field.polygon));
    setPolygonStatus(`${next.field.polygon.length} punkter · ${formatSquareMeters(next.field.areaM2)} · ${formatHectares(next.field.areaM2)} · roteret`);
    setViewBox(viewBoxForProject(next));
  }

  function pasteCurrentPolygon() {
    setPolygonInput(formatPolygonInput(project.field.polygon));
    setKnownAreaInput("");
    setPolygonStatus("Aktuel markpolygon er kopieret til tekstfeltet.");
  }

  function applyPolygonInput() {
    try {
      const parsed = parsePolygonInput(polygonInput);
      const calculatedAreaM2 = calculatePolygonArea(parsed.polygon);

      if (calculatedAreaM2 <= 0) {
        setPolygonStatus("Polygonen har ikke et målbart areal.");
        return;
      }

      const knownAreaM2 = knownAreaInput.trim() ? parseAreaInputToM2(knownAreaInput) : undefined;
      const scale = knownAreaM2 ? Math.sqrt(knownAreaM2 / calculatedAreaM2) : 1;
      const polygon = scale === 1 ? parsed.polygon : scalePolygon(parsed.polygon, scale);
      const areaM2 = calculatePolygonArea(polygon);
      const perimeterMeters = calculatePolygonPerimeter(polygon);

      commit(
        {
          ...project,
          field: {
            ...project.field,
            sourceType: parsed.sourceType,
            mapReference: parsed.mapReference ?? project.field.mapReference,
            polygon,
            areaM2,
            areaHa: areaM2 / 10_000,
            perimeterMeters,
            calibration: knownAreaM2
              ? {
                  method: "area",
                  meterPerPixel: scale,
                  knownAreaM2,
                  calculatedAreaM2: areaM2,
                  deviationPercent: 0,
                  warningDa: "Polygonen er skaleret efter kendt totalareal; afstandsregler bruger de skalerede meterkoordinater."
                }
              : project.field.calibration
          }
        },
        knownAreaM2 ? "Polygon indsat og skaleret efter totalareal" : "Polygon indsat med beregnet areal"
      );
      setPolygonInput(formatPolygonInput(polygon));
      setPolygonStatus(
        `${polygon.length} punkter · ${formatSquareMeters(areaM2)} · ${formatHectares(areaM2)}${parsed.projected ? " · lat/lon projekteret til meter" : ""}`
      );
    } catch (error) {
      setPolygonStatus(error instanceof Error ? error.message : "Polygonen kunne ikke læses.");
    }
  }

  function saveSnapshot() {
    setVersions((current) => [
      {
        id: crypto.randomUUID(),
        label: `Snapshot ${current.length + 1}`,
        snapshot: project,
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
    setStage("Snapshot gemt");
  }

  function restoreSnapshot(version: SnapshotVersion) {
    setProject({ ...version.snapshot, templates: version.snapshot.templates ?? dchTrackTemplates });
    setSelectedTrackIds(version.snapshot.tracks[0] ? [version.snapshot.tracks[0].id] : []);
    setVersionsOpen(false);
    setStage(`${version.label} gendannet`);
  }

  async function download(format: DownloadFormat) {
    const measuredProject = projectWithMeasuredTracks(project);

    if (format === "sheet-pdf") {
      setStage("Bygger PDF-sporlæggerark ...");
      const pdfBlob = await projectToTrackSheetPdfBlob(measuredProject);
      downloadBlob(pdfBlob, `${project.name}-sporlæggerark.pdf`, "application/pdf");
      setStage("PDF-sporlæggerark hentet");
      return;
    }

    const content =
      format === "svg"
        ? projectToSvg(measuredProject)
        : format === "geojson"
          ? JSON.stringify(projectToGeoJson(measuredProject), null, 2)
          : format === "sheet-html"
            ? projectToTrackSheetHtml(measuredProject)
            : format === "sheet-md"
              ? projectToTrackSheetMarkdown(measuredProject)
              : JSON.stringify(measuredProject, null, 2);
    const type =
      format === "svg"
        ? "image/svg+xml"
        : format === "sheet-html"
          ? "text/html"
          : format === "sheet-md"
            ? "text/markdown"
            : "application/json";
    const extension = format === "sheet-html" ? "html" : format === "sheet-md" ? "md" : format;
    downloadBlob(content, `${project.name}.${extension}`, type);
  }

  function addMeasurePoint(point: Coordinate) {
    const nextPoints = measurePoints.length >= 2 ? [point] : [...measurePoints, point];
    setMeasurePoints(nextPoints);
    setMeasureCursor(point);
    setStage(nextPoints.length === 2 ? `Målt afstand: ${formatMeters(distance(nextPoints[0], nextPoints[1]), 1)}` : "Målepunkt sat");
  }

  function clearMeasurement() {
    setMeasurePoints([]);
    setMeasureCursor(null);
    setStage("Måling nulstillet");
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const point = toWorld(event);

    if (tool === "measure" && measurePoints.length === 1) {
      setMeasureCursor(point);
    }

    if (!dragging) return;

    if (dragging.type === "pan") {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - dragging.lastClientX) / rect.width) * viewBox.width;
      const dy = ((event.clientY - dragging.lastClientY) / rect.height) * viewBox.height;
      setViewBox((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
      setDragging({ type: "pan", lastClientX: event.clientX, lastClientY: event.clientY });
      return;
    }

    if (dragging.type === "rotate") {
      const deltaDegrees = signedAngleDelta(dragging.startAngleDegrees, angleFrom(dragging.origin, point));
      const initialById = new Map(dragging.initialTracks.map((track) => [track.id, track]));
      setProject((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        tracks: current.tracks.map((track) => {
          const initial = initialById.get(track.id);
          return initial ? rotateTrack(initial, deltaDegrees, dragging.origin) : track;
        })
      }));
      setStage(`Roterer ${formatSignedDegrees(deltaDegrees)}`);
      return;
    }

    if (dragging.type === "object") {
      setProject((current) => {
        const track = current.tracks.find((candidate) => candidate.id === dragging.trackId);
        if (!track) {
          return current;
        }
        const distanceAlongTrackMeters = nearestDistanceAlongTrack(track.points, point);

        return {
          ...current,
          updatedAt: new Date().toISOString(),
          tracks: current.tracks.map((candidate) =>
            candidate.id === dragging.trackId
              ? {
                  ...candidate,
                  objects: candidate.objects.map((object) =>
                    object.id === dragging.objectId ? { ...object, distanceAlongTrackMeters } : object
                  )
                }
              : candidate
          )
        };
      });
      setStage("Genstand flyttes langs sporet");
      return;
    }

    const dx = point.x - dragging.last.x;
    const dy = point.y - dragging.last.y;
    setDragging({ ...dragging, last: point });
    const ids = selectedIds();
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      tracks: current.tracks.map((track) => (ids.includes(track.id) ? translateTrack(track, dx, dy) : track))
    }));
  }

  function finishPointerDrag() {
    if (dragging?.type === "track") {
      setSaveStatus("Ikke gemt");
      setStage("Spor flyttet");
      window.setTimeout(() => setSaveStatus("Gemt"), 450);
    }

    if (dragging?.type === "rotate") {
      setSaveStatus("Ikke gemt");
      setStage("Spor roteret med håndtag");
      window.setTimeout(() => setSaveStatus("Gemt"), 450);
    }

    if (dragging?.type === "object") {
      setSaveStatus("Ikke gemt");
      setStage("Genstand flyttet");
      window.setTimeout(() => setSaveStatus("Gemt"), 450);
    }

    setDragging(null);
  }

  function zoomAt(factor: number, anchor: Coordinate) {
    setViewBox((current) => ({
      x: anchor.x - (anchor.x - current.x) * factor,
      y: anchor.y - (anchor.y - current.y) * factor,
      width: current.width * factor,
      height: current.height * factor
    }));
  }

  function zoomCenter(factor: number) {
    zoomAt(factor, { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 });
  }

  function focusMessage(message: ValidationMessage) {
    if (!message.position) return;
    const size = Math.max(70, viewBox.width * 0.18);
    setViewBox({ x: message.position.x - size / 2, y: message.position.y - size / 2, width: size, height: size });
    setStage(message.messageDa);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="brand">DcH Sporplanlægger</p>
          <h1>{project.name}</h1>
          <p className="small">Real preview: samme domænefunktioner som appen, uden Next/Prisma-serveren.</p>
        </div>
        <div className="toolbar">
          <span className="pill ok">{saveStatus}</span>
          <button onClick={() => setMapOpen(true)}>Kort</button>
          <button onClick={() => setTemplateOpen(true)}>Templates</button>
          <button onClick={() => setVersionsOpen(true)}>Versioner</button>
          <button className="primary" onClick={runAutoPlacement}>
            Automatisk placering
          </button>
        </div>
      </header>

      <main className="grid">
        <aside className="sidebar left">
          <section className="section stack">
            <h2>Projekt</h2>
            <label>
              Projektnavn
              <input value={project.name} onChange={(event) => updateProjectMeta({ name: event.currentTarget.value })} />
            </label>
            <label>
              Klub
              <input value={project.club} onChange={(event) => updateProjectMeta({ club: event.currentTarget.value })} />
            </label>
            <label>
              Arrangement
              <input value={project.eventName} onChange={(event) => updateProjectMeta({ eventName: event.currentTarget.value })} />
            </label>
          </section>

          <section className="section stack">
            <h2>Mark</h2>
            <div className="two">
              <div className="metric">
                <span>Areal</span>
                <strong>{formatSquareMeters(project.field.areaM2)}</strong>
              </div>
              <div className="metric">
                <span>Hektar</span>
                <strong>{formatHectares(project.field.areaM2)}</strong>
              </div>
            </div>
            <div className="two">
              <label>
                Kantmargin
                <input
                  type="number"
                  value={project.edgeMarginMeters}
                  onChange={(event) => commit({ ...project, edgeMarginMeters: Number(event.currentTarget.value) }, "Kantmargin ændret")}
                />
              </label>
              <label>
                Sporafstand
                <input
                  type="number"
                  value={project.minimumTrackSpacingMeters}
                  onChange={(event) => commit({ ...project, minimumTrackSpacingMeters: Number(event.currentTarget.value) }, "Sporafstand ændret")}
                />
              </label>
            </div>
            <label>
              Upload markbillede
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadBackground(event.currentTarget.files?.[0])} />
            </label>
            <div className="two">
              <button onClick={rotateBackground}>Rotér billede</button>
              <button onClick={cropBackground}>Crop billede</button>
            </div>
            <div className="two">
              <button onClick={() => rotateFieldBy(-fieldRotationStepDegrees)}>- Rotér mark</button>
              <button onClick={() => rotateFieldBy(fieldRotationStepDegrees)}>+ Rotér mark</button>
            </div>
            <div className="two">
              <button onClick={() => setAutoDirectionDegrees(fieldAngleDegrees)}>Brug markretning</button>
              <button onClick={saveFieldVariant}>Gem markvariant</button>
            </div>
            <label>
              Markrotationstrin
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={fieldRotationStepDegrees}
                onChange={(event) => setFieldRotationStepDegrees(Math.max(0.5, Number(event.currentTarget.value) || 0.5))}
              />
            </label>
            <div className="message warning">Markretning: {formatDegrees(fieldAngleDegrees)}. Brug den som startretning, når spor skal følge markens lange side.</div>
            <label>
              Indsæt markpolygon
              <textarea
                value={polygonInput}
                rows={5}
                onChange={(event) => setPolygonInput(event.currentTarget.value)}
                placeholder={"0,0\n360,0\n360,80\n0,80"}
              />
            </label>
            <label>
              Kendt totalareal
              <input value={knownAreaInput} onChange={(event) => setKnownAreaInput(event.currentTarget.value)} placeholder="fx 28.310 m² eller 2,831 ha" />
            </label>
            <div className="two">
              <button onClick={applyPolygonInput}>Brug polygon</button>
              <button onClick={pasteCurrentPolygon}>Hent aktuel</button>
            </div>
            <div className="message warning">{polygonStatus}</div>
          </section>

          <section className="section stack">
            <h2>Spor</h2>
            <label>
              Sportype
              <select value={activeTemplateCode} onChange={(event) => setActiveTemplateCode(event.currentTarget.value)}>
                {trackProfiles.map((profile) => (
                  <option key={profile.code} value={profile.code}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Antal ved auto-placering
              <input
                ref={requestedTrackCountRef}
                type="number"
                min="1"
                max="1000"
                defaultValue={project.requestedTrackCount}
              />
            </label>
            <div className="metric">
              <span>Forslag ud fra markareal</span>
              <strong>{suggestedTrackCount} spor</strong>
            </div>
            <CapacityPanel estimates={capacityEstimates} activeCode={activeTemplateCode} onUse={(estimate) => {
              setActiveTemplateCode(estimate.code);
              if (requestedTrackCountRef.current) {
                requestedTrackCountRef.current.value = String(estimate.suggestedTrackCount);
              }
              setStage(`${estimate.label}: forslag sat til ${estimate.suggestedTrackCount} spor`);
            }} />
            <div className="two">
              <button
                onClick={() => {
                  if (requestedTrackCountRef.current) {
                    requestedTrackCountRef.current.value = String(suggestedTrackCount);
                  }
                  setStage(`Forslag sat til ${suggestedTrackCount} spor`);
                }}
              >
                Brug forslag
              </button>
              <button onClick={() => runAutoPlacement("maximum")}>Placer maks</button>
            </div>
            <label>
              Auto-retning
              <input
                type="number"
                step="1"
                value={autoDirectionDegrees}
                onChange={(event) => setAutoDirectionDegrees(normalizeDegrees(Number(event.currentTarget.value) || 0))}
              />
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={autoKeepExisting} onChange={(event) => setAutoKeepExisting(event.currentTarget.checked)} />
              Behold eksisterende spor og læg nye udenom
            </label>
            <div className="two">
              <button onClick={addTrack}>Tilføj valgt</button>
              <button className="primary" onClick={() => runAutoPlacement("requested")}>
                Autoplacer valgt
              </button>
              <button onClick={createCrossingExample}>Lav kryds</button>
              <button onClick={createBoundaryExample}>For tæt på skel</button>
              <button onClick={() => setStage(validation.valid ? "Projektet er gyldigt" : `${validation.errors.length} fejl fundet`)}>
                Validér
              </button>
            </div>
            <div className="mix-panel">
              <h3>B/A/E-mix</h3>
              <div className="three">
                {trackProfiles.map((profile) => (
                  <label key={profile.code}>
                    {profile.label}
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      value={mixedCounts[profile.code] ?? 0}
                      onChange={(event) => {
                        const nextCount = normalizeOptionalTrackCount(Number(event.currentTarget.value));
                        setMixedCounts((current) => ({ ...current, [profile.code]: nextCount }));
                      }}
                    />
                  </label>
                ))}
              </div>
              <button className="primary" onClick={runMixedPlacement}>
                Autoplacer mix
              </button>
            </div>
            {lastPlacementReport ? <PlacementSummary report={lastPlacementReport} insights={placementInsights} /> : null}
            <div className="scroll stack">
              {project.tracks.map((track) => (
                <button
                  key={track.id}
                  className={`track-row ${selectedTrackIds.includes(track.id) ? "active" : ""}`}
                  onDoubleClick={() => focusTrack(track)}
                  onClick={(event) => selectTrack(track.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                >
                  <span>{track.name}</span>
                  <span>{formatMeters(calculateTrackLength(track), 0)}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="canvas-column">
          <div className="canvasbar">
            <div className="toolbar">
              <button className={tool === "select" ? "primary" : ""} onClick={() => setTool("select")}>
                Vælg
              </button>
              <button className={tool === "pan" ? "primary" : ""} onClick={() => setTool("pan")}>
                Pan
              </button>
              <button className={tool === "measure" ? "primary" : ""} onClick={() => setTool("measure")}>
                Mål
              </button>
              {measurePoints.length > 0 ? <button onClick={clearMeasurement}>Ryd mål</button> : null}
              <button onClick={() => zoomCenter(0.82)}>+</button>
              <button onClick={() => zoomCenter(1.22)}>-</button>
              <button onClick={() => setViewBox(viewBoxForPoints(project.field.polygon, 18))}>Fit mark</button>
              <button onClick={() => setViewBox(viewBoxForProject(project))}>Fit alle</button>
              <button className={showRuleGuides ? "primary" : ""} onClick={() => setShowRuleGuides((current) => !current)}>
                Regelguides
              </button>
              <button className={showPlacementInsights ? "primary" : ""} onClick={() => setShowPlacementInsights((current) => !current)}>
                Autofeedback
              </button>
              <button className={showIssueLabels ? "primary" : ""} onClick={() => setShowIssueLabels((current) => !current)}>
                Fejllabels
              </button>
            </div>
            <div className="toolbar tight">
              <RuleGuideMiniSummary overlay={ruleGuideOverlay} />
              <span className="pill">{stage}</span>
            </div>
          </div>
          <div className="canvas-wrap">
            <svg
              ref={svgRef}
              className="editor-svg"
              viewBox={viewBoxToString(viewBox)}
              role="application"
              aria-label="Sporplan preview"
              onWheel={(event) => {
                event.preventDefault();
                zoomAt(event.deltaY < 0 ? 0.88 : 1.14, toWorld(event));
              }}
              onPointerDown={(event) => {
                if (tool === "measure") {
                  addMeasurePoint(toWorld(event));
                  return;
                }
                if (tool === "pan") {
                  svgRef.current?.setPointerCapture(event.pointerId);
                  setDragging({ type: "pan", lastClientX: event.clientX, lastClientY: event.clientY });
                }
              }}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointerDrag}
              onPointerLeave={finishPointerDrag}
            >
              {project.field.backgroundImage ? <BackgroundImage image={project.field.backgroundImage} /> : null}
              <polygon points={project.field.polygon.map(pointToSvg).join(" ")} fill="#d9eed9" stroke="#2f6235" strokeWidth={1.6} opacity={0.86} />
              {showRuleGuides ? <RuleGuides project={project} overlay={ruleGuideOverlay} viewBox={viewBox} /> : null}
              {showPlacementInsights ? <PlacementInsightOverlay insights={placementInsights} project={project} viewBox={viewBox} /> : null}
              {!showIssueLabels ? <IssueMarkers messages={messages} /> : null}
              {project.restrictedAreas.map((area) =>
                area.type === "polygon" ? (
                  <polygon key={area.id} points={area.polygon.map(pointToSvg).join(" ")} fill={area.color} opacity={0.22} stroke={area.color} strokeWidth={1} />
                ) : null
              )}
              <text x={project.field.polygon[0]?.x ?? 0} y={(project.field.polygon[0]?.y ?? 0) - 5} fill="#16201b" fontSize="6" fontWeight="700">
                {project.field.name} · {formatSquareMeters(project.field.areaM2)}
              </text>
              {project.tracks.map((track) => (
                <TrackSvg
                  key={track.id}
                  track={track}
                  selected={selectedTrackIds.includes(track.id)}
                  selectedObjectId={selectedObjectId}
                  viewBox={viewBox}
                  onRotatePointerDown={startRotationDrag}
                  onObjectPointerDown={startObjectDrag}
                  onPointerDown={(event) => {
                    if (tool === "pan") return;
                    if (tool === "measure") return;
                    event.stopPropagation();
                    svgRef.current?.setPointerCapture(event.pointerId);
                    selectTrack(track.id, event.shiftKey || event.metaKey || event.ctrlKey);
                    setDragging({ type: "track", trackId: track.id, last: toWorld(event) });
                  }}
                />
              ))}
              <MeasureOverlay measurement={activeMeasurement} points={measurePoints} viewBox={viewBox} />
              {focusTarget ? <FocusMarker target={focusTarget} viewBox={viewBox} /> : null}
              {showIssueLabels ? <IssueLabels messages={messages} /> : null}
              <ScaleBar viewBox={viewBox} />
            </svg>
          </div>
          <footer className="footer">
            <span>Værktøj: {tool}</span>
            <span>Markeret: {selectedTrackIds.length} spor</span>
            <span>Mål: meterkoordinater</span>
          </footer>
        </section>

        <aside className="sidebar right">
          <section className="section stack">
            <div className="toolbar">
              <h2>Egenskaber</h2>
              <span className={`pill ${validation.valid ? "ok" : "error"}`}>{validation.valid ? "Gyldig" : `${validation.errors.length} fejl`}</span>
            </div>
            {selectedTrack ? (
              <div className="card">
                <h3>{selectedTrack.name}</h3>
                <p className="small">
                  {formatMeters(calculateTrackLength(selectedTrack))} · {selectedTrack.objects.length} genstande
                </p>
                <p className="small">
                  Segmenter: {calculateSegmentLengths(selectedTrack.points).map((length) => formatMeters(length)).join(" · ")}
                </p>
              </div>
            ) : (
              <p className="small">Vælg et spor.</p>
            )}
            <div className="two">
              <button onClick={duplicateSelected}>Duplikér</button>
              <button onClick={() => transformSelected((track) => mirrorTrack(track, "y"), "Spor spejlvendt")}>Spejlvend</button>
              <button onClick={() => rotateSelectedBy(-rotationStepDegrees)}>- Rotér</button>
              <button onClick={() => rotateSelectedBy(rotationStepDegrees)}>+ Rotér</button>
              <button onClick={alignSelectedToField}>Ret til mark</button>
              <button className="danger" onClick={deleteSelected}>
                Slet
              </button>
            </div>
            <label>
              Rotationstrin
              <input
                type="number"
                step="0.5"
                min="0.5"
                value={rotationStepDegrees}
                onChange={(event) => setRotationStepDegrees(Math.max(0.5, Number(event.currentTarget.value) || 0.5))}
              />
            </label>
            <label>
              Finrotation
              <input
                type="range"
                min="-15"
                max="15"
                step="0.5"
                value={rotationNudgeDegrees}
                onChange={(event) => setRotationNudgeDegrees(Number(event.currentTarget.value))}
              />
            </label>
            <div className="two">
              <button onClick={rotateSelectedByNudge}>Anvend {formatSignedDegrees(rotationNudgeDegrees)}</button>
              <button onClick={() => setRotationNudgeDegrees(0)}>Nulstil trin</button>
            </div>
            <div className="quick-buttons">
              {[0.5, 1, 2.5, 5, 10].map((value) => (
                <button key={value} onClick={() => setRotationStepDegrees(value)}>
                  {value}°
                </button>
              ))}
            </div>
            <div className="nudge-pad">
              <button onClick={() => moveSelectedBy(0, -1)}>Op 1 m</button>
              <button onClick={() => moveSelectedBy(-1, 0)}>Venstre 1 m</button>
              <button onClick={() => moveSelectedBy(1, 0)}>Højre 1 m</button>
              <button onClick={() => moveSelectedBy(0, 1)}>Ned 1 m</button>
            </div>
            <div className="nudge-pad">
              <button onClick={() => moveSelectedBy(0, -5)}>Op 5 m</button>
              <button onClick={() => moveSelectedBy(-5, 0)}>Venstre 5 m</button>
              <button onClick={() => moveSelectedBy(5, 0)}>Højre 5 m</button>
              <button onClick={() => moveSelectedBy(0, 5)}>Ned 5 m</button>
            </div>
            <div className="measure-card">
              <div className="toolbar">
                <strong>Måling</strong>
                <span>{activeMeasurement ? formatMeters(activeMeasurement.distanceMeters, 1) : "-"}</span>
              </div>
              <div className="two">
                <button className={tool === "measure" ? "primary" : ""} onClick={() => setTool("measure")}>
                  Mål
                </button>
                <button onClick={clearMeasurement}>Ryd</button>
              </div>
            </div>
            {selectedTrack ? (
              <ObjectEditor
                track={selectedTrack}
                selectedObjectId={selectedObjectId}
                onSelect={setSelectedObjectId}
                onChangeDistance={(objectId, distanceMeters) =>
                  updateObjectDistance(selectedTrack.id, objectId, distanceMeters, `Genstand flyttet til ${formatMeters(distanceMeters, 1)}`)
                }
              />
            ) : null}
          </section>

          <section className="section stack">
            <h2>Regelstatus</h2>
            {selectedTrack ? (
              <RuleStatusPanel track={selectedTrack} checks={selectedTrackRuleChecks} onFocus={focusRule} />
            ) : (
              <div className="message warning">Vælg et spor for at se regelstatus.</div>
            )}
            <RuleGuidePanel overlay={ruleGuideOverlay} onFocus={focusGuide} />
          </section>

          <section className="section stack">
            <h2>Validering</h2>
            <div className="scroll stack">
              {messages.length === 0 ? (
                <div className="message">Ingen valideringsfejl.</div>
              ) : (
                messages.map((message, index) => <ValidationRow key={`${message.code}-${index}`} message={message} onFocus={() => focusMessage(message)} />)
              )}
            </div>
          </section>

          <section className="section stack">
            <h2>Eksport</h2>
            <div className="two">
              <button onClick={() => void download("svg")}>SVG</button>
              <button onClick={() => void download("geojson")}>GeoJSON</button>
              <button onClick={() => void download("json")}>Projekt JSON</button>
              <button className="primary" onClick={() => void download("sheet-pdf")}>PDF-ark</button>
              <button onClick={() => void download("sheet-html")}>HTML-ark</button>
              <button onClick={() => void download("sheet-md")}>Markdownark</button>
            </div>
          </section>
        </aside>
      </main>

      <MapModal
        open={mapOpen}
        project={project}
        onClose={() => setMapOpen(false)}
        onSave={(next) => {
          commit(next, "Kortpolygon gemt");
          setPolygonInput(formatPolygonInput(next.field.polygon));
          setKnownAreaInput("");
          setPolygonStatus(`${next.field.polygon.length} punkter · ${formatSquareMeters(next.field.areaM2)} · ${formatHectares(next.field.areaM2)}`);
          setViewBox(viewBoxForProject(next));
          setMapOpen(false);
        }}
      />

      <TemplateModal
        open={templateOpen}
        project={project}
        onClose={() => setTemplateOpen(false)}
        onSave={(next) => {
          commit(next, "Regeltemplate gemt");
          setTemplateOpen(false);
        }}
      />

      <VersionModal
        open={versionsOpen}
        versions={versions}
        onClose={() => setVersionsOpen(false)}
        onSave={saveSnapshot}
        onRestore={restoreSnapshot}
      />
    </div>
  );
}

function TrackSvg({
  track,
  selected,
  selectedObjectId,
  viewBox,
  onPointerDown,
  onRotatePointerDown,
  onObjectPointerDown
}: {
  track: Track;
  selected: boolean;
  selectedObjectId: string | null;
  viewBox: ViewBoxState;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onRotatePointerDown: (event: React.PointerEvent<SVGCircleElement>, trackId: string) => void;
  onObjectPointerDown: (event: React.PointerEvent<SVGGElement>, trackId: string, objectId: string) => void;
}) {
  return (
    <g onPointerDown={onPointerDown}>
      <polyline
        points={track.points.map(pointToSvg).join(" ")}
        fill="none"
        stroke={track.color}
        strokeWidth={selected ? 3.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={track.points[0].x} cy={track.points[0].y} r={3.3} fill={track.color} />
      <rect
        x={track.points[track.points.length - 1].x - 2.8}
        y={track.points[track.points.length - 1].y - 2.8}
        width={5.6}
        height={5.6}
        fill="#fff"
        stroke={track.color}
        strokeWidth={1}
      />
      <text x={track.points[1].x + 2} y={track.points[1].y - 2} fill="#16201b" fontSize="5" fontWeight="700">
        {track.name}
      </text>
      {track.objects.map((object) => {
        const position = coordinateAtDistance(track.points, object.distanceAlongTrackMeters);
        const objectSelected = selected && selectedObjectId === object.id;
        return (
          <g key={object.id} className="object-handle" onPointerDown={(event) => onObjectPointerDown(event, track.id, object.id)}>
            <circle
              cx={position.x}
              cy={position.y}
              r={objectSelected ? 3.7 : 2.7}
              fill="#fff"
              stroke={objectSelected ? "#16201b" : track.color}
              strokeWidth={objectSelected ? 1.4 : 1}
            />
            <text x={position.x + 2.8} y={position.y - 2.8} fill="#16201b" fontSize="4" fontWeight={objectSelected ? "800" : "500"}>
              G{object.displayNo}
            </text>
          </g>
        );
      })}
      {selected ? <RotationHandle track={track} viewBox={viewBox} onPointerDown={onRotatePointerDown} /> : null}
    </g>
  );
}

function RotationHandle({
  track,
  viewBox,
  onPointerDown
}: {
  track: Track;
  viewBox: ViewBoxState;
  onPointerDown: (event: React.PointerEvent<SVGCircleElement>, trackId: string) => void;
}) {
  const center = trackCenter(track);
  const handle = rotationHandlePosition(track, viewBox);
  const radius = Math.max(3.4, viewBox.width / 112);
  const strokeWidth = Math.max(0.9, viewBox.width / 520);

  return (
    <g className="rotation-handle" pointerEvents="all">
      <line x1={center.x} y1={center.y} x2={handle.x} y2={handle.y} stroke="#16201b" strokeWidth={strokeWidth} strokeDasharray="2 2" opacity={0.72} />
      <circle
        cx={handle.x}
        cy={handle.y}
        r={radius * 1.85}
        fill="#ffffff"
        stroke="#16201b"
        strokeWidth={strokeWidth}
        onPointerDown={(event) => onPointerDown(event, track.id)}
      />
      <circle cx={handle.x} cy={handle.y} r={radius * 0.72} fill={track.color} pointerEvents="none" />
      <text x={handle.x} y={handle.y - radius * 2.15} textAnchor="middle" fill="#16201b" fontSize={radius * 1.25} fontWeight="800" pointerEvents="none">
        R
      </text>
    </g>
  );
}

function MeasureOverlay({
  measurement,
  points,
  viewBox
}: {
  measurement: { start: Coordinate; end: Coordinate; distanceMeters: number } | null;
  points: Coordinate[];
  viewBox: ViewBoxState;
}) {
  const radius = Math.max(3.3, viewBox.width / 120);
  const textSize = Math.max(4.5, viewBox.width / 86);

  if (points.length === 0) {
    return null;
  }

  return (
    <g pointerEvents="none">
      {measurement ? (
        <>
          <line
            x1={measurement.start.x}
            y1={measurement.start.y}
            x2={measurement.end.x}
            y2={measurement.end.y}
            stroke="#0b7285"
            strokeWidth={Math.max(1, viewBox.width / 460)}
            strokeDasharray="4 2"
          />
          <MeasureLabel measurement={measurement} textSize={textSize} />
        </>
      ) : null}
      {points.map((point, index) => (
        <g key={`measure-point-${index}`}>
          <circle cx={point.x} cy={point.y} r={radius} fill="#ffffff" stroke="#0b7285" strokeWidth={Math.max(0.9, viewBox.width / 520)} />
          <circle cx={point.x} cy={point.y} r={radius * 0.38} fill="#0b7285" />
        </g>
      ))}
    </g>
  );
}

function MeasureLabel({ measurement, textSize }: { measurement: { start: Coordinate; end: Coordinate; distanceMeters: number }; textSize: number }) {
  const center = midpoint(measurement.start, measurement.end);
  const label = formatMeters(measurement.distanceMeters, 1);
  const width = Math.max(textSize * 9, label.length * textSize * 0.75);
  const height = textSize * 3.2;

  return (
    <g>
      <rect x={center.x - width / 2} y={center.y - height - textSize * 0.55} width={width} height={height} rx={textSize * 0.42} fill="#e7f5ff" stroke="#0b7285" strokeWidth={0.5} opacity={0.94} />
      <text x={center.x} y={center.y - height * 0.58} textAnchor="middle" fill="#0b7285" fontSize={textSize} fontWeight="800">
        {label}
      </text>
    </g>
  );
}

function FocusMarker({ target, viewBox }: { target: NonNullable<FocusTarget>; viewBox: ViewBoxState }) {
  const radius = Math.max(6, viewBox.width / 42);
  const textSize = Math.max(4.5, viewBox.width / 78);

  return (
    <g pointerEvents="none">
      <circle cx={target.position.x} cy={target.position.y} r={radius} fill="none" stroke="#16201b" strokeWidth={Math.max(1, viewBox.width / 260)} opacity={0.82} />
      <circle cx={target.position.x} cy={target.position.y} r={radius * 0.55} fill="none" stroke="#ffffff" strokeWidth={Math.max(0.8, viewBox.width / 420)} opacity={0.9} />
      <text x={target.position.x + radius * 1.2} y={target.position.y - radius * 0.85} fill="#16201b" fontSize={textSize} fontWeight="700">
        {target.label}
      </text>
    </g>
  );
}

function RuleStatusPanel({ track, checks, onFocus }: { track: Track; checks: RuleCheck[]; onFocus: (check: RuleCheck) => void }) {
  const errors = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warning").length;

  return (
    <div className="stack">
      <div className={`rule-summary ${errors > 0 ? "error" : warnings > 0 ? "warning" : "ok"}`}>
        <strong>{track.name}</strong>
        <span>{errors > 0 ? `${errors} fejl` : warnings > 0 ? `${warnings} advarsler` : "Alle hovedregler ok"}</span>
      </div>
      <div className="rule-list">
        {checks.map((check) => (
          <button key={check.id} className={`rule-row ${check.status}`} onClick={() => onFocus(check)}>
            <span className="status-dot" />
            <span>
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </span>
            <em>{check.value}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function CapacityPanel({
  estimates,
  activeCode,
  onUse
}: {
  estimates: CapacityEstimate[];
  activeCode: string;
  onUse: (estimate: CapacityEstimate) => void;
}) {
  return (
    <div className="capacity-panel">
      <div className="toolbar">
        <strong>Kapacitet</strong>
        <span className="small">areal, skel og afstand</span>
      </div>
      <div className="capacity-grid">
        {estimates.map((estimate) => (
          <button key={estimate.code} className={`capacity-card ${estimate.code === activeCode ? "active" : ""}`} onClick={() => onUse(estimate)}>
            <strong>{estimate.label}</strong>
            <span>{estimate.suggestedTrackCount} realistisk</span>
            <small>op til {estimate.optimisticTrackCount} ved tæt pakning</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlacementSummary({ report, insights }: { report: PlacementReport; insights: PlacementInsight[] }) {
  const issueCount = insights.reduce((sum, insight) => sum + insight.issueCount, 0);
  const tightCount = insights.filter((insight) => insight.status === "warning").length;

  return (
    <div className="placement-summary">
      <div className="toolbar">
        <strong>{report.mode === "maximum" ? "Maksforslag" : report.mode === "mixed" ? "Mixforslag" : "Autoforslag"}</strong>
        <span>{formatDegrees(report.directionDegrees)}</span>
      </div>
      <p>
        {report.result.placedTrackCount}/{report.result.requestedTrackCount} nye spor · {report.result.tracks.length} i planen
      </p>
      <p className="small">{report.summary}</p>
      {report.triedDirections.length > 0 ? <p className="small">Retninger prøvet: {report.triedDirections.map(formatDegrees).join(", ")}</p> : null}
      <div className={`placement-health ${issueCount > 0 ? "error" : tightCount > 0 ? "warning" : "ok"}`}>
        <strong>{issueCount > 0 ? `${issueCount} regelbrud` : tightCount > 0 ? `${tightCount} tæt på grænsen` : "Forslaget er rent"}</strong>
        <span>{report.result.candidatesEvaluated} kandidater vurderet på bedste forsøg</span>
      </div>
      {insights.length > 0 ? (
        <div className="placement-insight-list">
          {insights.slice(0, 8).map((insight) => (
            <div key={insight.trackId} className={`placement-insight-row ${insight.status}`}>
              <strong>{insight.name}</strong>
              <span>Skel {formatMeters(insight.boundaryDistanceMeters, 1)}</span>
              <span>
                Nabo {insight.nearestTrackDistanceMeters === undefined ? "-" : formatMeters(insight.nearestTrackDistanceMeters, 1)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RuleGuideMiniSummary({ overlay }: { overlay: RuleGuideOverlay }) {
  const className = overlay.errorCount > 0 ? "error" : overlay.warningCount > 0 ? "warning" : "ok";

  return (
    <span className={`pill ${className}`}>
      {overlay.errorCount > 0
        ? `${overlay.errorCount} regelbrud`
        : overlay.warningCount > 0
          ? `${overlay.warningCount} tæt på`
          : "Regler ok"}
    </span>
  );
}

function RuleGuidePanel({ overlay, onFocus }: { overlay: RuleGuideOverlay; onFocus: (guide: DistanceGuide | IntersectionGuide) => void }) {
  const distanceGuides = [...overlay.edgeGuides, ...overlay.trackGuides].filter((guide) => guide.status !== "ok");
  const guides = [...overlay.intersections, ...distanceGuides].slice(0, 6);

  return (
    <div className="rule-guide-card">
      <div className="toolbar">
        <strong>Overlay</strong>
        <span className="small">
          {overlay.guideTrackIds.length} spor · {overlay.intersections.length} kryds
        </span>
      </div>
      {guides.length === 0 ? (
        <p className="small">Ingen synlige afstandsbrud for de markerede spor.</p>
      ) : (
        <div className="stack">
          {guides.map((guide) => (
            <button key={guide.id} className="guide-row" onClick={() => onFocus(guide)}>
              <strong>{guide.label}</strong>
              {"distanceMeters" in guide ? (
                <span>
                  {formatMeters(guide.distanceMeters)} / krav {formatMeters(guide.requiredMeters)}
                </span>
              ) : (
                <span>Kryds mellem spor</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectEditor({
  track,
  selectedObjectId,
  onSelect,
  onChangeDistance
}: {
  track: Track;
  selectedObjectId: string | null;
  onSelect: (objectId: string) => void;
  onChangeDistance: (objectId: string, distanceMeters: number) => void;
}) {
  const lengthMeters = calculateTrackLength(track);

  return (
    <div className="object-card">
      <div className="toolbar">
        <strong>Genstande</strong>
        <span className="small">{track.objects.length} stk.</span>
      </div>
      <div className="stack">
        {track.objects.map((object) => {
          const selected = object.id === selectedObjectId;
          const distanceMeters = Math.max(0, Math.min(lengthMeters, object.distanceAlongTrackMeters));

          return (
            <div key={object.id} className={`object-row ${selected ? "active" : ""}`}>
              <button onClick={() => onSelect(object.id)}>
                G{object.displayNo}
                {object.marksFinish ? " · slut" : ""}
              </button>
              <label>
                Afstand
                <input
                  type="number"
                  min="0"
                  max={Math.ceil(lengthMeters)}
                  step="0.5"
                  value={Number(distanceMeters.toFixed(1))}
                  onChange={(event) => onChangeDistance(object.id, Number(event.currentTarget.value))}
                />
              </label>
              <input
                aria-label={`G${object.displayNo} afstand`}
                type="range"
                min="0"
                max={Math.max(1, Math.ceil(lengthMeters))}
                step="0.5"
                value={distanceMeters}
                onChange={(event) => onChangeDistance(object.id, Number(event.currentTarget.value))}
              />
              <div className="object-nudges">
                <button onClick={() => onChangeDistance(object.id, distanceMeters - 5)}>-5 m</button>
                <button onClick={() => onChangeDistance(object.id, distanceMeters - 1)}>-1 m</button>
                <button onClick={() => onChangeDistance(object.id, distanceMeters + 1)}>+1 m</button>
                <button onClick={() => onChangeDistance(object.id, distanceMeters + 5)}>+5 m</button>
              </div>
              {object.marksFinish ? <button onClick={() => onChangeDistance(object.id, lengthMeters)}>Til slut</button> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BackgroundImage({ image }: { image: FieldBackgroundImage }) {
  const cropLeft = image.widthMeters * (image.crop.leftPercent / 100);
  const cropTop = image.heightMeters * (image.crop.topPercent / 100);
  const cropWidth = image.widthMeters - cropLeft - image.widthMeters * (image.crop.rightPercent / 100);
  const cropHeight = image.heightMeters - cropTop - image.heightMeters * (image.crop.bottomPercent / 100);
  const clipId = `preview-bg-${image.storageKey.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <g opacity={image.opacity} transform={`rotate(${image.rotationDegrees} ${image.x + image.widthMeters / 2} ${image.y + image.heightMeters / 2})`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={image.x + cropLeft} y={image.y + cropTop} width={Math.max(1, cropWidth)} height={Math.max(1, cropHeight)} />
        </clipPath>
      </defs>
      <image href={image.url} x={image.x} y={image.y} width={image.widthMeters} height={image.heightMeters} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />
    </g>
  );
}

function IssueMarkers({ messages }: { messages: ValidationMessage[] }) {
  return (
    <g pointerEvents="none">
      {messages
        .filter((message) => message.position)
        .map((message, index) => (
          <circle
            key={`issue-marker-${message.code}-${message.trackId}-${index}`}
            cx={message.position?.x ?? 0}
            cy={message.position?.y ?? 0}
            r={3.2}
            fill="#ffffff"
            opacity={0.78}
            stroke={message.severity === "error" ? "#c92a2a" : "#f59f00"}
            strokeWidth={0.9}
          />
        ))}
    </g>
  );
}

function IssueLabels({ messages }: { messages: ValidationMessage[] }) {
  return (
    <g pointerEvents="none">
      {messages
        .filter((message) => message.position)
        .map((message, index) => (
          <g key={`issue-label-${message.code}-${message.trackId}-${index}`}>
            <rect
              x={(message.position?.x ?? 0) + 3}
              y={(message.position?.y ?? 0) + 3 + index * 2}
              width={Math.max(34, message.messageDa.length * 2)}
              height={8}
              rx={1.5}
              fill={message.severity === "error" ? "#fff5f5" : "#fff9db"}
              stroke={message.severity === "error" ? "#c92a2a" : "#f59f00"}
              strokeWidth={0.4}
            />
            <text
              x={(message.position?.x ?? 0) + 5}
              y={(message.position?.y ?? 0) + 9 + index * 2}
              fill={message.severity === "error" ? "#c92a2a" : "#9c6b00"}
              fontSize="4"
            >
              {message.messageDa}
            </text>
          </g>
        ))}
    </g>
  );
}

function RuleGuides({ project, overlay, viewBox }: { project: ProjectSnapshot; overlay: RuleGuideOverlay; viewBox: ViewBoxState }) {
  const textSize = Math.max(4.4, viewBox.width / 95);
  const markerSize = Math.max(4, viewBox.width / 95);

  return (
    <g pointerEvents="none">
      <polygon
        points={project.field.polygon.map(pointToSvg).join(" ")}
        fill="none"
        stroke="#c92a2a"
        strokeWidth={project.edgeMarginMeters * 2}
        opacity={0.08}
      />
      {project.tracks
        .filter((track) => overlay.guideTrackIds.includes(track.id))
        .map((track) => (
          <polyline
            key={`guide-${track.id}`}
            points={track.points.map(pointToSvg).join(" ")}
            fill="none"
            stroke="#f59f00"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={project.minimumTrackSpacingMeters * 2}
            opacity={0.12}
          />
        ))}
      {[...overlay.edgeGuides, ...overlay.trackGuides].map((guide) => (
        <g key={guide.id}>
          <line
            x1={guide.from.x}
            y1={guide.from.y}
            x2={guide.to.x}
            y2={guide.to.y}
            stroke={guide.status === "error" ? "#c92a2a" : guide.status === "warning" ? "#f59f00" : "#2f6235"}
            strokeWidth={Math.max(0.8, viewBox.width / 520)}
            strokeDasharray={guide.status === "ok" ? "2 2" : "3 2"}
            opacity={guide.status === "ok" ? 0.45 : 0.86}
          />
          {guide.status !== "ok" ? <GuideLabel guide={guide} textSize={textSize} /> : null}
        </g>
      ))}
      {overlay.intersections.map((intersection) => (
        <g key={intersection.id}>
          <circle cx={intersection.position.x} cy={intersection.position.y} r={markerSize * 0.85} fill="#fff5f5" stroke="#c92a2a" strokeWidth={Math.max(0.8, viewBox.width / 520)} />
          <line
            x1={intersection.position.x - markerSize}
            y1={intersection.position.y - markerSize}
            x2={intersection.position.x + markerSize}
            y2={intersection.position.y + markerSize}
            stroke="#c92a2a"
            strokeWidth={Math.max(0.9, viewBox.width / 470)}
          />
          <line
            x1={intersection.position.x - markerSize}
            y1={intersection.position.y + markerSize}
            x2={intersection.position.x + markerSize}
            y2={intersection.position.y - markerSize}
            stroke="#c92a2a"
            strokeWidth={Math.max(0.9, viewBox.width / 470)}
          />
          <text x={intersection.position.x + markerSize * 1.25} y={intersection.position.y - markerSize * 0.9} fill="#c92a2a" fontSize={textSize} fontWeight="800">
            Kryds
          </text>
        </g>
      ))}
    </g>
  );
}

function PlacementInsightOverlay({
  insights,
  project,
  viewBox
}: {
  insights: PlacementInsight[];
  project: ProjectSnapshot;
  viewBox: ViewBoxState;
}) {
  const textSize = Math.max(4.2, viewBox.width / 96);
  const badgeRadius = Math.max(4.2, viewBox.width / 98);

  if (insights.length === 0) {
    return null;
  }

  return (
    <g pointerEvents="none">
      {insights.map((insight, index) => {
        const track = project.tracks.find((candidate) => candidate.id === insight.trackId);
        if (!track) {
          return null;
        }
        const nearest = nearestConnectorToProject(project, track);
        const stroke = insight.status === "error" ? "#c92a2a" : insight.status === "warning" ? "#f59f00" : "#2f6235";

        return (
          <g key={`placement-insight-${insight.trackId}`}>
            <polyline
              points={track.points.map(pointToSvg).join(" ")}
              fill="none"
              stroke={stroke}
              strokeWidth={Math.max(0.9, viewBox.width / 420)}
              strokeDasharray="5 3"
              opacity={0.8}
            />
            {nearest ? (
              <line
                x1={nearest.from.x}
                y1={nearest.from.y}
                x2={nearest.to.x}
                y2={nearest.to.y}
                stroke={stroke}
                strokeWidth={Math.max(0.7, viewBox.width / 560)}
                opacity={0.72}
              />
            ) : null}
            <circle cx={insight.position.x} cy={insight.position.y} r={badgeRadius} fill="#ffffff" stroke={stroke} strokeWidth={Math.max(0.8, viewBox.width / 520)} />
            <text x={insight.position.x} y={insight.position.y + textSize * 0.35} textAnchor="middle" fill={stroke} fontSize={textSize} fontWeight="900">
              {index + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GuideLabel({ guide, textSize }: { guide: DistanceGuide; textSize: number }) {
  const center = midpoint(guide.from, guide.to);
  const width = Math.max(textSize * 8.5, guide.label.length * textSize * 0.55);
  const height = textSize * 2.9;
  const fill = guide.status === "error" ? "#fff5f5" : "#fff9db";
  const stroke = guide.status === "error" ? "#c92a2a" : "#f59f00";

  return (
    <g>
      <rect x={center.x + textSize * 0.8} y={center.y - height} width={width} height={height} rx={textSize * 0.35} fill={fill} stroke={stroke} strokeWidth={0.45} opacity={0.93} />
      <text x={center.x + textSize * 1.45} y={center.y - height * 0.52} fill={stroke} fontSize={textSize} fontWeight="800">
        {formatMeters(guide.distanceMeters, 1)}
      </text>
    </g>
  );
}

function ScaleBar({ viewBox }: { viewBox: ViewBoxState }) {
  const lengthMeters = niceScaleLength(viewBox.width);
  const x = viewBox.x + viewBox.width - lengthMeters - viewBox.width * 0.055;
  const y = viewBox.y + viewBox.height - viewBox.height * 0.07;
  const textSize = Math.max(4, viewBox.width / 72);

  return (
    <g pointerEvents="none">
      <rect x={x - textSize} y={y - textSize * 3.1} width={lengthMeters + textSize * 2} height={textSize * 4.2} fill="#ffffff" opacity={0.84} rx={textSize * 0.35} />
      <line x1={x} y1={y} x2={x + lengthMeters} y2={y} stroke="#16201b" strokeWidth={Math.max(1, viewBox.width / 380)} />
      <line x1={x} y1={y - textSize * 0.65} x2={x} y2={y + textSize * 0.65} stroke="#16201b" strokeWidth={Math.max(1, viewBox.width / 430)} />
      <line x1={x + lengthMeters} y1={y - textSize * 0.65} x2={x + lengthMeters} y2={y + textSize * 0.65} stroke="#16201b" strokeWidth={Math.max(1, viewBox.width / 430)} />
      <text x={x + lengthMeters / 2} y={y - textSize * 1.15} textAnchor="middle" fill="#16201b" fontSize={textSize} fontWeight="700">
        {formatMeters(lengthMeters, 0)}
      </text>
    </g>
  );
}

function ValidationRow({ message, onFocus }: { message: ValidationMessage; onFocus: () => void }) {
  return (
    <button className={`message message-row ${message.severity === "error" ? "error" : "warning"}`} onClick={onFocus} disabled={!message.position}>
      <strong>{message.code}</strong>
      <p>{message.messageDa}</p>
      {message.requiredValue !== undefined ? (
        <p className="small">
          Målt {message.actualValue?.toFixed(1)} {message.unit}, krav {message.requiredValue.toFixed(1)} {message.unit}
        </p>
      ) : null}
    </button>
  );
}

function MapModal({
  open,
  project,
  onClose,
  onSave
}: {
  open: boolean;
  project: ProjectSnapshot;
  onClose: () => void;
  onSave: (project: ProjectSnapshot) => void;
}) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [query, setQuery] = useState(project.field.mapReference?.address ?? "Holbæk");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [points, setPoints] = useState<GeocodeResult[]>([]);
  const [rotationDegrees, setRotationDegrees] = useState(0);
  const [status, setStatus] = useState("Søg adresse og klik polygonpunkter i kortet.");
  const projectedPreview = useMemo(
    () =>
      points.length >= 3
        ? createProjectedMapPolygon(points, query, mapRef.current?.getZoom() ?? project.field.mapReference?.zoom ?? 15, rotationDegrees)
        : undefined,
    [points, project.field.mapReference?.zoom, query, rotationDegrees]
  );

  useEffect(() => {
    if (!open || !mapElementRef.current || mapRef.current) return;
    const center: [number, number] = [project.field.mapReference?.centerLat ?? 55.6761, project.field.mapReference?.centerLon ?? 12.5683];
    const map = L.map(mapElementRef.current).setView(center, project.field.mapReference?.zoom ?? 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
    const layers = L.layerGroup().addTo(map);
    layerRef.current = layers;
    map.on("click", (event: L.LeafletMouseEvent) => {
      setPoints((current) => [...current, { label: `Punkt ${current.length + 1}`, lat: event.latlng.lat, lon: event.latlng.lng }]);
      setStatus("Punkt tilføjet.");
    });
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 100);
  }, [open, project.field.mapReference?.centerLat, project.field.mapReference?.centerLon, project.field.mapReference?.zoom]);

  useEffect(() => {
    const layers = layerRef.current;
    if (!layers) return;
    layers.clearLayers();
    points.forEach((point, index) => {
      L.circleMarker([point.lat, point.lon], { radius: 5, color: "#2f6235", fillColor: "#fff", fillOpacity: 1, weight: 2 })
        .bindTooltip(`${index + 1}`)
        .addTo(layers);
    });
    if (points.length > 1) {
      L.polyline(points.map((point) => [point.lat, point.lon] as [number, number]), { color: "#2f6235", weight: 3 }).addTo(layers);
    }
    if (points.length > 2) {
      L.polygon(points.map((point) => [point.lat, point.lon] as [number, number]), { color: "#2f6235", fillColor: "#d9eed9", fillOpacity: 0.35 }).addTo(layers);
    }
  }, [points]);

  async function search() {
    setStatus("Søger adresse ...");
    const response = await fetch(`/api/geocode?query=${encodeURIComponent(query)}`);
    const payload = (await response.json()) as { success: boolean; data?: GeocodeResult[]; error?: { message: string } };
    if (!payload.success || !payload.data) {
      setStatus(payload.error?.message ?? "Adresseopslag fejlede.");
      return;
    }
    setResults(payload.data);
    setStatus(payload.data.length > 0 ? "Vælg et resultat." : "Ingen resultater.");
  }

  function choose(result: GeocodeResult) {
    setQuery(result.label);
    mapRef.current?.setView([result.lat, result.lon], 17);
    setStatus("Kortet er flyttet til adressen.");
  }

  function save() {
    if (!projectedPreview) {
      setStatus("Vælg mindst tre polygonpunkter.");
      return;
    }

    onSave({
      ...project,
      field: {
        ...project.field,
        sourceType: "map",
        mapReference: projectedPreview.mapReference,
        polygon: projectedPreview.polygon,
        areaM2: projectedPreview.areaM2,
        areaHa: projectedPreview.areaM2 / 10_000,
        perimeterMeters: projectedPreview.perimeterMeters
      }
    });
  }

  return (
    <div className={`modal ${open ? "open" : ""}`}>
      <div className="modal-card">
        <div className="toolbar">
          <h2>Kortworkflow med adresseopslag og projektion</h2>
          <button className="danger" onClick={onClose}>
            Luk
          </button>
        </div>
        <div className="map-layout">
          <div className="stack">
            <label>
              Adresse eller stednavn
              <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
            </label>
            <div className="two">
              <button onClick={() => void search()}>Søg</button>
              <button className="primary" onClick={save}>
                Gem polygon
              </button>
            </div>
            <div className="message warning">{status}</div>
            <label>
              Rotation før import
              <input
                type="range"
                min="-90"
                max="90"
                step="1"
                value={rotationDegrees}
                onChange={(event) => setRotationDegrees(Number(event.currentTarget.value))}
              />
            </label>
            <div className="two">
              <button onClick={() => setRotationDegrees((current) => current - 5)}>-5°</button>
              <button onClick={() => setRotationDegrees((current) => current + 5)}>+5°</button>
            </div>
            <div className="message">
              {projectedPreview
                ? `${formatSignedDegrees(rotationDegrees)} · ${formatSquareMeters(projectedPreview.areaM2)} · ${formatHectares(projectedPreview.areaM2)} · omkreds ${formatMeters(projectedPreview.perimeterMeters, 1)}`
                : "Areal vises, når polygonen har mindst tre punkter."}
            </div>
            <div className="scroll stack">
              {results.map((result) => (
                <button key={`${result.lat}-${result.lon}`} onClick={() => choose(result)}>
                  {result.label}
                </button>
              ))}
            </div>
            <button onClick={() => setPoints((current) => current.slice(0, -1))}>Fortryd punkt</button>
          </div>
          <div ref={mapElementRef} className="map-panel" />
        </div>
      </div>
    </div>
  );
}

function TemplateModal({
  open,
  project,
  onClose,
  onSave
}: {
  open: boolean;
  project: ProjectSnapshot;
  onClose: () => void;
  onSave: (project: ProjectSnapshot) => void;
}) {
  const [lengthSteps, setLengthSteps] = useState(project.template.lengthSteps);
  const [stepLengthMeters, setStepLengthMeters] = useState(project.template.stepLengthMeters);
  const lengthMeters = lengthSteps * stepLengthMeters;

  function save() {
    const template = {
      ...project.template,
      lengthSteps,
      stepLengthMeters,
      lengthMeters,
      minMiddleSegmentMeters: project.template.minMiddleSegmentSteps * stepLengthMeters,
      minTrackSpacingMeters: project.template.minTrackSpacingSteps * stepLengthMeters
    };

    onSave({
      ...project,
      template,
      templates: replaceTemplate(project.templates ?? dchTrackTemplates, template)
    });
  }

  return (
    <div className={`modal ${open ? "open" : ""}`}>
      <div className="modal-card">
        <div className="toolbar">
          <h2>Admin: regeltemplate</h2>
          <button className="danger" onClick={onClose}>
            Luk
          </button>
        </div>
        <div className="two">
          <label>
            Længde
            <input type="number" value={lengthSteps} onChange={(event) => setLengthSteps(Number(event.currentTarget.value))} />
          </label>
          <label>
            Skridtlængde
            <input type="number" step="0.01" value={stepLengthMeters} onChange={(event) => setStepLengthMeters(Number(event.currentTarget.value))} />
          </label>
        </div>
        <div className="message warning">Afledt længde: {lengthMeters.toFixed(1)} m. Nye valideringer bruger værdien straks.</div>
        <button className="primary" onClick={save}>
          Gem regler
        </button>
      </div>
    </div>
  );
}

function VersionModal({
  open,
  versions,
  onClose,
  onSave,
  onRestore
}: {
  open: boolean;
  versions: SnapshotVersion[];
  onClose: () => void;
  onSave: () => void;
  onRestore: (version: SnapshotVersion) => void;
}) {
  return (
    <div className={`modal ${open ? "open" : ""}`}>
      <div className="modal-card">
        <div className="toolbar">
          <h2>Versionshistorik</h2>
          <button className="danger" onClick={onClose}>
            Luk
          </button>
        </div>
        <button className="primary" onClick={onSave}>
          Gem snapshot
        </button>
        <div className="stack">
          {versions.map((version) => (
            <div className="card" key={version.id}>
              <div className="toolbar">
                <div>
                  <h3>{version.label}</h3>
                  <p className="small">{new Date(version.createdAt).toLocaleString("da-DK")}</p>
                </div>
                <button onClick={() => onRestore(version)}>Gendan</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function viewBoxForProject(project: ProjectSnapshot): ViewBoxState {
  const points = [
    ...project.field.polygon,
    ...project.tracks.flatMap((track) => track.points),
    ...project.restrictedAreas.flatMap((area) => (area.type === "polygon" ? area.polygon : []))
  ];
  return viewBoxForPoints(points, 20);
}

function viewBoxForPoints(points: Coordinate[], padding = 20): ViewBoxState {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  const width = Math.max(20, Math.max(...xs) - Math.min(...xs) + padding * 2);
  const height = Math.max(20, Math.max(...ys) - Math.min(...ys) + padding * 2);
  return { x: minX, y: minY, width, height };
}

function viewBoxToString(viewBox: ViewBoxState): string {
  return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
}

function niceScaleLength(widthMeters: number): number {
  const target = widthMeters / 5;
  const exponent = Math.floor(Math.log10(Math.max(1, target)));
  const base = 10 ** exponent;
  const candidates = [1, 2, 5, 10].map((factor) => factor * base);
  return candidates.reduce((best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best), candidates[0]);
}

function normalizeTrackCount(value: number): number {
  return Math.max(1, Math.min(1000, Math.round(value || 1)));
}

function normalizeOptionalTrackCount(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(Number.isFinite(value) ? value : 0)));
}

function normalizeDegrees(value: number): number {
  return ((value % 180) + 180) % 180;
}

function signedAngleDelta(fromDegrees: number, toDegrees: number): number {
  return ((((toDegrees - fromDegrees) % 360) + 540) % 360) - 180;
}

function angleFrom(origin: Coordinate, point: Coordinate): number {
  return (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI;
}

function formatDegrees(value: number): string {
  return `${Number(normalizeDegrees(value).toFixed(1))}°`;
}

function formatSignedDegrees(value: number): string {
  return `${Number(value.toFixed(1))}°`;
}

function uniqueDirections(values: number[]): number[] {
  return [...new Set(values.map((value) => normalizeDegrees(Math.round(value))))];
}

function summarizeRejectedReasons(rejectedReasons: Record<string, number>): string {
  const labels: Record<string, string> = {
    OUTSIDE_FIELD: "uden for marken",
    EDGE_MARGIN: "for tæt på skel",
    TRACK_INTERSECTION: "krydsede andre spor",
    TRACK_SPACING: "for tæt på andre spor",
    RESTRICTED_AREA: "ramte forbudt område",
    MIDDLE_SEGMENT_LENGTH: "havde for korte ben mellem knæk",
    TURN_ANGLE: "havde forkerte knæk"
  };
  const entries = Object.entries(rejectedReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);

  if (entries.length === 0) {
    return "";
  }

  return `Afviste kandidater især fordi de ${entries.map(([code, count]) => `${labels[code] ?? code} (${count})`).join(", ")}.`;
}

function buildPlacementInsights(project: ProjectSnapshot, validation: ProjectValidationResult, report: PlacementReport): PlacementInsight[] {
  const reportTrackIds = new Set(report.result.tracks.map((track) => track.id));

  return project.tracks
    .filter((track) => reportTrackIds.has(track.id))
    .map((track) => {
      const rules = rulesForTrack(project, track);
      const messages = [...(validation.tracks[track.id]?.errors ?? []), ...(validation.tracks[track.id]?.warnings ?? [])];
      const edgeGuide = edgeGuideForTrack(project, track);
      const nearestTrack = nearestTrackGuideForTrack(project, track);
      const spacingRequiredMeters = Math.max(project.minimumTrackSpacingMeters, rules.minTrackSpacingMeters);
      const edgeStatus = edgeGuide ? edgeGuide.status : "ok";
      const spacingStatus = nearestTrack ? nearestTrack.status : "ok";
      const status = messages.some((message) => message.severity === "error")
        ? "error"
        : edgeStatus === "warning" || spacingStatus === "warning" || messages.some((message) => message.severity === "warning")
          ? "warning"
          : "ok";

      return {
        trackId: track.id,
        name: track.name,
        status,
        position: track.points[0],
        boundaryDistanceMeters: edgeGuide?.distanceMeters ?? Number.POSITIVE_INFINITY,
        boundaryRequiredMeters: project.edgeMarginMeters,
        nearestTrackDistanceMeters: nearestTrack?.distanceMeters,
        nearestTrackName: nearestTrack?.relatedTrackId ? project.tracks.find((candidate) => candidate.id === nearestTrack.relatedTrackId)?.name : undefined,
        spacingRequiredMeters,
        lengthMeters: calculateTrackLength(track),
        issueCount: messages.filter((message) => message.severity === "error").length
      };
    });
}

function fieldPrimaryAngle(polygon: Coordinate[]): number {
  if (polygon.length < 2) {
    return 0;
  }

  let longest = { length: 0, angle: 0 };
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);

    if (length > longest.length) {
      longest = { length, angle: (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI };
    }
  }

  return normalizeDegrees(longest.angle);
}

function resolveTrackProfile(code: string, project: ProjectSnapshot): TrackProfile {
  const baseProfile = trackProfiles.find((profile) => profile.code === code) ?? trackProfiles[0];
  const template =
    code === project.template.code
      ? project.template
      : project.templates?.find((candidate) => candidate.code === code) ?? dchTrackTemplates.find((candidate) => candidate.code === code) ?? baseProfile.template;

  return {
    ...baseProfile,
    template,
    segmentLengthsMeters: scaledSegments(baseProfile.segmentLengthsMeters, template.lengthMeters)
  };
}

function rulesForTrack(project: ProjectSnapshot, track: Track): TrackTemplateRules {
  if (!track.templateCode || track.templateCode === project.template.code) {
    return project.template;
  }

  return project.templates?.find((template) => template.code === track.templateCode) ?? project.template;
}

function buildTrackRuleChecks(project: ProjectSnapshot, track: Track, validation: ProjectValidationResult): RuleCheck[] {
  const rules = rulesForTrack(project, track);
  const result = validation.tracks[track.id];
  const messages = [...(result?.errors ?? []), ...(result?.warnings ?? [])];
  const measurements = result?.measurements;
  const expectedAngles = rules.turnAnglesDegrees ?? Array.from({ length: rules.turnCount }, () => rules.turnAngleDegrees);
  const turnAngles = measurements?.turnAnglesDegrees ?? calculateTurnAngles(track.points);
  const segmentLengths = measurements?.segmentLengthsMeters ?? calculateSegmentLengths(track.points);
  const lengthMeters = measurements?.totalLengthMeters ?? calculateTrackLength(track);
  const nearestBoundary = measurements?.nearestBoundaryDistanceMeters;
  const nearestTrack = measurements?.nearestTrackDistanceMeters;

  return [
    ruleCheck("length", "Længde", ["TRACK_LENGTH"], messages, track, {
      value: `${formatMeters(lengthMeters)} / ${formatMeters(rules.lengthMeters)}`,
      detail: `Tolerance ${formatMeters(rules.lengthToleranceMeters)}`
    }),
    ruleCheck("turns", "Knæk", ["TRACK_POINT_COUNT", "SEGMENT_COUNT", "TURN_ANGLE"], messages, track, {
      value: turnAngles.map((angle) => `${Math.round(angle)}°`).join(" · ") || "-",
      detail: `Krav: ${expectedAngles.map((angle) => `${angle}°`).join(" · ")}`
    }),
    ruleCheck("middle", "Ben mellem knæk", ["MIDDLE_SEGMENT_LENGTH"], messages, track, {
      value: segmentLengths.slice(1, -1).map((length) => formatMeters(length)).join(" · ") || "-",
      detail: `Minimum ${formatMeters(rules.minMiddleSegmentMeters)}`
    }),
    ruleCheck("field", "Mark og skel", ["OUTSIDE_FIELD", "EDGE_MARGIN"], messages, track, {
      value: nearestBoundary === undefined ? "-" : formatMeters(nearestBoundary),
      detail: `Kantmargin ${formatMeters(project.edgeMarginMeters)}`
    }),
    ruleCheck("spacing", "Afstand/kryds", ["TRACK_INTERSECTION", "TRACK_SPACING", "SELF_INTERSECTION"], messages, track, {
      value: nearestTrack === undefined ? "Ingen nabo" : formatMeters(nearestTrack),
      detail: `Minimum ${formatMeters(project.minimumTrackSpacingMeters)} mellem spor`
    }),
    ruleCheck("objects", "Genstande", ["OBJECT_COUNT", "OBJECT_TOO_CLOSE_TO_FINISH"], messages, track, {
      value: `${track.objects.length}/${rules.objectCount}`,
      detail: `Øvrige genstande skal ligge mindst ${formatMeters(rules.minLastObjectToFinishMeters)} før slut`
    }),
    ruleCheck("restricted", "Forbudte områder", ["RESTRICTED_AREA"], messages, track, {
      value: project.restrictedAreas.filter((area) => area.active).length === 0 ? "Ingen" : `${project.restrictedAreas.filter((area) => area.active).length} aktive`,
      detail: "Sporet må ikke ramme aktive forbudszoner"
    })
  ];
}

function ruleCheck(
  id: string,
  label: string,
  codes: string[],
  messages: ValidationMessage[],
  track: Track,
  fallback: { value: string; detail: string }
): RuleCheck {
  const matching = messages.find((message) => codes.includes(message.code));

  if (!matching) {
    return {
      id,
      label,
      status: "ok",
      value: fallback.value,
      detail: fallback.detail,
      position: trackCenter(track),
      trackId: track.id
    };
  }

  return {
    id,
    label,
    status: matching.severity === "error" ? "error" : "warning",
    value:
      matching.actualValue !== undefined && matching.requiredValue !== undefined
        ? `${Number(matching.actualValue.toFixed(1))}/${Number(matching.requiredValue.toFixed(1))} ${matching.unit ?? ""}`.trim()
        : fallback.value,
    detail: matching.messageDa,
    position: matching.position ?? trackCenter(track),
    trackId: track.id
  };
}

function buildRuleGuideOverlay(project: ProjectSnapshot, selectedTrackIds: string[], validation: ProjectValidationResult): RuleGuideOverlay {
  const issueTrackIds = new Set(
    [...validation.errors, ...validation.warnings]
      .flatMap((message) => [message.trackId, message.relatedTrackId])
      .filter((trackId): trackId is string => Boolean(trackId))
  );
  const selectedSet = new Set(selectedTrackIds);
  let guideTrackIds = project.tracks.filter((track) => selectedSet.has(track.id)).map((track) => track.id);

  if (guideTrackIds.length === 0) {
    guideTrackIds = project.tracks.filter((track) => issueTrackIds.has(track.id)).map((track) => track.id);
  }

  if (guideTrackIds.length === 0 && project.tracks[0]) {
    guideTrackIds = [project.tracks[0].id];
  }

  const guideTracks = project.tracks.filter((track) => guideTrackIds.includes(track.id));
  const edgeGuides = guideTracks.flatMap((track) => {
    const guide = edgeGuideForTrack(project, track);
    return guide ? [guide] : [];
  });
  const trackGuides: DistanceGuide[] = [];
  const intersections: IntersectionGuide[] = [];
  const seenPairs = new Set<string>();

  guideTracks.forEach((track) => {
    project.tracks.forEach((otherTrack) => {
      if (track.id === otherTrack.id) {
        return;
      }

      const pairId = [track.id, otherTrack.id].sort().join("-");
      if (seenPairs.has(pairId)) {
        return;
      }
      seenPairs.add(pairId);

      trackIntersectionPoints(track, otherTrack).slice(0, 4).forEach((position, index) => {
        intersections.push({
          id: `intersection-${pairId}-${index}`,
          label: `${track.name} krydser ${otherTrack.name}`,
          position,
          trackId: track.id,
          relatedTrackId: otherTrack.id
        });
      });

      const connector = nearestConnectorBetweenPolylines(track.points, otherTrack.points);
      if (!connector) {
        return;
      }

      const requiredMeters = Math.max(
        project.minimumTrackSpacingMeters,
        rulesForTrack(project, track).minTrackSpacingMeters,
        rulesForTrack(project, otherTrack).minTrackSpacingMeters
      );
      const crosses = trackIntersectionPoints(track, otherTrack).length > 0;

      trackGuides.push({
        id: `spacing-${pairId}`,
        label: crosses ? `${track.name} krydser ${otherTrack.name}` : `${track.name} til ${otherTrack.name}`,
        from: connector.from,
        to: connector.to,
        distanceMeters: connector.distanceMeters,
        requiredMeters,
        status: crosses ? "error" : clearanceStatus(connector.distanceMeters, requiredMeters),
        trackId: track.id,
        relatedTrackId: otherTrack.id
      });
    });
  });

  const errorCount =
    intersections.length +
    edgeGuides.filter((guide) => guide.status === "error").length +
    trackGuides.filter((guide) => guide.status === "error").length;
  const warningCount =
    edgeGuides.filter((guide) => guide.status === "warning").length +
    trackGuides.filter((guide) => guide.status === "warning").length;

  return {
    guideTrackIds,
    edgeGuides,
    trackGuides,
    intersections,
    errorCount,
    warningCount
  };
}

function edgeGuideForTrack(project: ProjectSnapshot, track: Track): DistanceGuide | undefined {
  const connector = nearestConnectorToPolygon(track.points, project.field.polygon);
  if (!connector) {
    return undefined;
  }

  return {
    id: `edge-${track.id}`,
    label: `${track.name} til skel`,
    from: connector.from,
    to: connector.to,
    distanceMeters: connector.distanceMeters,
    requiredMeters: project.edgeMarginMeters,
    status: clearanceStatus(connector.distanceMeters, project.edgeMarginMeters),
    trackId: track.id
  };
}

function nearestTrackGuideForTrack(project: ProjectSnapshot, track: Track): DistanceGuide | undefined {
  let best: DistanceGuide | undefined;

  project.tracks.forEach((otherTrack) => {
    if (otherTrack.id === track.id) {
      return;
    }

    const connector = nearestConnectorBetweenPolylines(track.points, otherTrack.points);
    if (!connector) {
      return;
    }

    const requiredMeters = Math.max(
      project.minimumTrackSpacingMeters,
      rulesForTrack(project, track).minTrackSpacingMeters,
      rulesForTrack(project, otherTrack).minTrackSpacingMeters
    );
    const crosses = trackIntersectionPoints(track, otherTrack).length > 0;
    const guide: DistanceGuide = {
      id: `nearest-${track.id}-${otherTrack.id}`,
      label: crosses ? `${track.name} krydser ${otherTrack.name}` : `${track.name} til ${otherTrack.name}`,
      from: connector.from,
      to: connector.to,
      distanceMeters: connector.distanceMeters,
      requiredMeters,
      status: crosses ? "error" : clearanceStatus(connector.distanceMeters, requiredMeters),
      trackId: track.id,
      relatedTrackId: otherTrack.id
    };

    if (!best || guide.distanceMeters < best.distanceMeters) {
      best = guide;
    }
  });

  return best;
}

function nearestConnectorToProject(project: ProjectSnapshot, track: Track): SegmentConnector | undefined {
  const edge = nearestConnectorToPolygon(track.points, project.field.polygon);
  const nearestTrack = nearestTrackGuideForTrack(project, track);

  if (!edge) {
    return nearestTrack ? { from: nearestTrack.from, to: nearestTrack.to, distanceMeters: nearestTrack.distanceMeters } : undefined;
  }

  if (!nearestTrack || edge.distanceMeters <= nearestTrack.distanceMeters) {
    return edge;
  }

  return { from: nearestTrack.from, to: nearestTrack.to, distanceMeters: nearestTrack.distanceMeters };
}

function clearanceStatus(distanceMeters: number, requiredMeters: number): RuleStatus {
  if (distanceMeters + 1e-6 < requiredMeters) {
    return "error";
  }

  if (distanceMeters < requiredMeters + Math.max(3, requiredMeters * 0.18)) {
    return "warning";
  }

  return "ok";
}

function nearestConnectorToPolygon(points: Coordinate[], polygon: Coordinate[]): SegmentConnector | undefined {
  let best: SegmentConnector | undefined;

  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const connector = nearestConnectorBetweenSegments(
        points[pointIndex],
        points[pointIndex + 1],
        polygon[edgeIndex],
        polygon[(edgeIndex + 1) % polygon.length]
      );
      if (!best || connector.distanceMeters < best.distanceMeters) {
        best = connector;
      }
    }
  }

  return best;
}

type SegmentConnector = {
  from: Coordinate;
  to: Coordinate;
  distanceMeters: number;
};

function nearestConnectorBetweenPolylines(a: Coordinate[], b: Coordinate[]): SegmentConnector | undefined {
  let best: SegmentConnector | undefined;

  for (let aIndex = 0; aIndex < a.length - 1; aIndex += 1) {
    for (let bIndex = 0; bIndex < b.length - 1; bIndex += 1) {
      const connector = nearestConnectorBetweenSegments(a[aIndex], a[aIndex + 1], b[bIndex], b[bIndex + 1]);
      if (!best || connector.distanceMeters < best.distanceMeters) {
        best = connector;
      }
    }
  }

  return best;
}

function nearestConnectorBetweenSegments(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): SegmentConnector {
  if (segmentsIntersect(a1, a2, b1, b2)) {
    const position = segmentIntersectionPoint(a1, a2, b1, b2);
    return { from: position, to: position, distanceMeters: 0 };
  }

  const candidates = [
    connectorFromPointToSegment(a1, b1, b2, "a"),
    connectorFromPointToSegment(a2, b1, b2, "a"),
    connectorFromPointToSegment(b1, a1, a2, "b"),
    connectorFromPointToSegment(b2, a1, a2, "b")
  ].sort((left, right) => left.distanceMeters - right.distanceMeters);
  const measuredDistance = distanceBetweenSegments(a1, a2, b1, b2);

  return { ...candidates[0], distanceMeters: measuredDistance };
}

function connectorFromPointToSegment(point: Coordinate, start: Coordinate, end: Coordinate, source: "a" | "b"): SegmentConnector {
  const projected = nearestPointOnSegment(point, start, end);
  return source === "a"
    ? { from: point, to: projected, distanceMeters: distance(point, projected) }
    : { from: projected, to: point, distanceMeters: distance(point, projected) };
}

function nearestPointOnSegment(point: Coordinate, start: Coordinate, end: Coordinate): Coordinate {
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;

  if (segmentLengthSquared === 0) {
    return start;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) /
        segmentLengthSquared
    )
  );

  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
}

function nearestDistanceAlongTrack(points: Coordinate[], point: Coordinate): number {
  let best = { distanceToTrack: Number.POSITIVE_INFINITY, distanceAlongTrackMeters: 0 };
  let traversed = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segmentLength = distance(start, end);

    if (segmentLength === 0) {
      continue;
    }

    const projected = nearestPointOnSegment(point, start, end);
    const distanceToTrack = distance(point, projected);
    const distanceOnSegment = distance(start, projected);

    if (distanceToTrack < best.distanceToTrack) {
      best = {
        distanceToTrack,
        distanceAlongTrackMeters: traversed + distanceOnSegment
      };
    }

    traversed += segmentLength;
  }

  return Math.max(0, Math.min(traversed, best.distanceAlongTrackMeters));
}

function trackIntersectionPoints(track: Track, otherTrack: Track): Coordinate[] {
  const intersections: Coordinate[] = [];

  for (let trackIndex = 0; trackIndex < track.points.length - 1; trackIndex += 1) {
    for (let otherIndex = 0; otherIndex < otherTrack.points.length - 1; otherIndex += 1) {
      const start = track.points[trackIndex];
      const end = track.points[trackIndex + 1];
      const otherStart = otherTrack.points[otherIndex];
      const otherEnd = otherTrack.points[otherIndex + 1];
      if (segmentsIntersect(start, end, otherStart, otherEnd)) {
        intersections.push(segmentIntersectionPoint(start, end, otherStart, otherEnd));
      }
    }
  }

  return intersections;
}

function segmentIntersectionPoint(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): Coordinate {
  const denominator = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);

  if (Math.abs(denominator) < 1e-9) {
    return [a1, a2, b1, b2].find((point) => pointOnSegment(point, a1, a2) && pointOnSegment(point, b1, b2)) ?? midpoint(a1, b1);
  }

  const aCross = a1.x * a2.y - a1.y * a2.x;
  const bCross = b1.x * b2.y - b1.y * b2.x;

  return {
    x: (aCross * (b1.x - b2.x) - (a1.x - a2.x) * bCross) / denominator,
    y: (aCross * (b1.y - b2.y) - (a1.y - a2.y) * bCross) / denominator
  };
}

function pointOnSegment(point: Coordinate, start: Coordinate, end: Coordinate): boolean {
  return Math.abs(distance(start, point) + distance(point, end) - distance(start, end)) < 1e-5;
}

function midpoint(start: Coordinate, end: Coordinate): Coordinate {
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
}

function relabelTracks(tracks: Track[]): Track[] {
  return tracks.map((track, index) => ({ ...track, displayNo: index + 1, name: renameTrack(track, index + 1) }));
}

function scaledSegments(segments: number[], targetLengthMeters: number): number[] {
  const currentLength = segments.reduce((sum, length) => sum + length, 0);
  const scale = targetLengthMeters / currentLength;
  return segments.map((length) => length * scale);
}

function estimateTrackCapacities(project: ProjectSnapshot): CapacityEstimate[] {
  return trackProfiles.map((profile) => {
    const resolved = resolveTrackProfile(profile.code, project);
    return estimateTrackCapacityDetailed(project, resolved.template, resolved.label);
  });
}

function estimateTrackCapacity(project: ProjectSnapshot, template: TrackTemplateRules): number {
  return estimateTrackCapacityDetailed(project, template, template.name).suggestedTrackCount;
}

function estimateTrackCapacityDetailed(project: ProjectSnapshot, template: TrackTemplateRules, label: string): CapacityEstimate {
  const spacing = Math.max(project.minimumTrackSpacingMeters, template.minTrackSpacingMeters);
  const bounds = polygonBounds(project.field.polygon);
  const sideLength = Math.max(1, (template.lengthMeters - template.minMiddleSegmentMeters) / 2);
  const cellWidth = sideLength + spacing;
  const cellHeight = Math.max(template.minMiddleSegmentMeters, bounds.height * 0.12, 1) + spacing;
  const turnComplexity = template.turnCount >= 6 ? 1.45 : template.turnCount >= 3 ? 1.2 : 1;
  const edgePenaltyArea = project.field.perimeterMeters * project.edgeMarginMeters + project.edgeMarginMeters * project.edgeMarginMeters * 4;
  const usableAreaM2 = Math.max(0, project.field.areaM2 - edgePenaltyArea);
  const areaPerTrackM2 = Math.max(1, cellWidth * cellHeight * turnComplexity);
  const optimisticTrackCount = normalizeTrackCount(Math.max(1, Math.floor(usableAreaM2 / areaPerTrackM2)));
  const suggestedTrackCount = normalizeTrackCount(Math.max(1, Math.floor(optimisticTrackCount * 0.78)));

  return {
    code: template.code,
    label,
    suggestedTrackCount,
    optimisticTrackCount,
    usableAreaM2,
    areaPerTrackM2,
    spacingMeters: spacing,
    lengthMeters: template.lengthMeters
  };
}

function withActiveTemplate(project: ProjectSnapshot, template: TrackTemplateRules): ProjectSnapshot {
  return {
    ...project,
    template,
    templates: replaceTemplate(project.templates ?? dchTrackTemplates, template)
  };
}

function replaceTemplate(templates: TrackTemplateRules[], template: TrackTemplateRules): TrackTemplateRules[] {
  const replaced = templates.some((candidate) => candidate.code === template.code)
    ? templates.map((candidate) => (candidate.code === template.code ? template : candidate))
    : [...templates, template];
  return replaced;
}

function renameTrack(track: Track, displayNo: number): string {
  const prefix = trackProfiles.find((profile) => profile.code === track.templateCode)?.prefix ?? "Spor";
  return `${prefix} ${displayNo}`;
}

function trackCenter(track: Track): Coordinate {
  const sum = track.points.reduce((accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }), {
    x: 0,
    y: 0
  });
  return { x: sum.x / track.points.length, y: sum.y / track.points.length };
}

function centerOfTracks(tracks: Track[]): Coordinate {
  const centers = tracks.map(trackCenter);
  const sum = centers.reduce((accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }), {
    x: 0,
    y: 0
  });
  return {
    x: sum.x / Math.max(1, centers.length),
    y: sum.y / Math.max(1, centers.length)
  };
}

function rotationHandlePosition(track: Track, viewBox: ViewBoxState): Coordinate {
  const center = trackCenter(track);
  const first = track.points[0];
  const second = track.points[1] ?? { x: first.x + 1, y: first.y };
  const heading = Math.atan2(second.y - first.y, second.x - first.x);
  const armLength = Math.max(14, Math.min(34, viewBox.width / 13));

  return {
    x: center.x + Math.cos(heading - Math.PI / 2) * armLength,
    y: center.y + Math.sin(heading - Math.PI / 2) * armLength
  };
}

function projectWithMeasuredTracks(project: ProjectSnapshot): ProjectSnapshot {
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      const lengthMeters = calculateTrackLength(track);
      return {
        ...track,
        lengthMeters,
        lengthSteps: Math.round(metersToSteps(lengthMeters, track.stepLengthMeters))
      };
    })
  };
}

function projectToTrackSheetMarkdown(project: ProjectSnapshot): string {
  const validation = validateProject(project);
  const lines = [
    `# Sporlæggerark - ${project.name}`,
    "",
    `Klub: ${project.club || "-"}`,
    `Arrangement: ${project.eventName || "-"}`,
    `Mark: ${project.field.name}`,
    `Areal: ${formatSquareMeters(project.field.areaM2)} / ${formatHectares(project.field.areaM2)}`,
    `Spor i planen: ${project.tracks.length}`,
    `Validering: ${validation.valid ? "Gyldig" : `${validation.errors.length} fejl og ${validation.warnings.length} advarsler`}`,
    "",
    "## Spor"
  ];

  project.tracks.forEach((track) => {
    const checks = buildTrackRuleChecks(project, track, validation);
    const segmentLengths = calculateSegmentLengths(track.points);
    const turnAngles = calculateTurnAngles(track.points);
    lines.push(
      "",
      `### ${track.name}`,
      `Type: ${rulesForTrack(project, track).name}`,
      `Længde: ${formatMeters(calculateTrackLength(track))}`,
      `Segmenter: ${segmentLengths.map((length) => formatMeters(length)).join(" · ")}`,
      `Knæk: ${turnAngles.map((angle) => `${Math.round(angle)}°`).join(" · ") || "-"}`,
      `Regelstatus: ${checks.filter((check) => check.status === "error").length} fejl, ${checks.filter((check) => check.status === "warning").length} advarsler`,
      "Genstande:",
      ...track.objects.map((object) => `- G${object.displayNo}: ${formatMeters(object.distanceAlongTrackMeters)} fra start, ${object.material}`),
      "Noter: ________________________________________________"
    );
  });

  return lines.join("\n");
}

function projectToTrackSheetHtml(project: ProjectSnapshot): string {
  const validation = validateProject(project);
  const overviewSvg = projectToSvg(project, { width: 1100, height: 700 });
  const trackSections = project.tracks
    .map((track) => {
      const checks = buildTrackRuleChecks(project, track, validation);
      const segmentLengths = calculateSegmentLengths(track.points);
      const turnAngles = calculateTurnAngles(track.points);
      const checkRows = checks
        .map(
          (check) =>
            `<tr><td>${escapeHtml(check.label)}</td><td>${escapeHtml(statusLabel(check.status))}</td><td>${escapeHtml(check.value)}</td><td>${escapeHtml(check.detail)}</td></tr>`
        )
        .join("");
      const objectRows = track.objects
        .map((object) => `<tr><td>G${object.displayNo}</td><td>${formatMeters(object.distanceAlongTrackMeters)}</td><td>${escapeHtml(object.material)}</td></tr>`)
        .join("");

      return `<section class="page">
        <h2>${escapeHtml(track.name)}</h2>
        <p>${escapeHtml(rulesForTrack(project, track).name)} · ${formatMeters(calculateTrackLength(track))} · ${track.objects.length} genstande</p>
        <p>Segmenter: ${segmentLengths.map((length) => formatMeters(length)).join(" · ")}</p>
        <p>Knæk: ${turnAngles.map((angle) => `${Math.round(angle)}°`).join(" · ") || "-"}</p>
        <h3>Regler</h3>
        <table><thead><tr><th>Regel</th><th>Status</th><th>Måling</th><th>Detalje</th></tr></thead><tbody>${checkRows}</tbody></table>
        <h3>Genstande</h3>
        <table><thead><tr><th>Genstand</th><th>Afstand</th><th>Materiale</th></tr></thead><tbody>${objectRows}</tbody></table>
        <div class="notes">Noter<br /><br /></div>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(project.name)} - sporlæggerark</title>
    <style>
      body { font-family: Arial, sans-serif; color: #16201b; margin: 24px; }
      h1, h2, h3 { margin: 0 0 8px; }
      p { margin: 4px 0 10px; }
      .overview { margin-bottom: 24px; }
      .overview svg { width: 100%; height: auto; border: 1px solid #d7ded7; }
      .page { break-before: page; margin-top: 28px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; font-size: 12px; }
      th, td { border: 1px solid #d7ded7; padding: 6px; text-align: left; vertical-align: top; }
      th { background: #eef8ee; }
      .notes { min-height: 90px; border: 1px solid #d7ded7; padding: 8px; }
      @media print { body { margin: 12mm; } .page { break-before: page; } }
    </style>
  </head>
  <body>
    <section class="overview">
      <h1>${escapeHtml(project.name)}</h1>
      <p>${escapeHtml(project.club || "-")} · ${escapeHtml(project.eventName || "-")} · ${formatSquareMeters(project.field.areaM2)} · ${formatHectares(project.field.areaM2)}</p>
      ${overviewSvg}
    </section>
    ${trackSections}
  </body>
</html>`;
}

async function projectToTrackSheetPdfBlob(project: ProjectSnapshot): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const validation = validateProject(project);

  drawPdfCover(doc, project, validation);
  project.tracks.forEach((track) => {
    doc.addPage();
    drawPdfTrackSheetPage(doc, project, validation, track);
  });

  return doc.output("blob");
}

type PreviewPdfDocument = {
  setFont: (fontName: string, fontStyle?: string) => PreviewPdfDocument;
  setFontSize: (size: number) => PreviewPdfDocument;
  setDrawColor: (color: string) => PreviewPdfDocument;
  setFillColor: (color: string) => PreviewPdfDocument;
  setLineWidth: (width: number) => PreviewPdfDocument;
  setTextColor: (color: string) => PreviewPdfDocument;
  text: (text: string, x: number, y: number, options?: { maxWidth?: number; align?: "left" | "center" | "right" }) => PreviewPdfDocument;
  line: (x1: number, y1: number, x2: number, y2: number) => PreviewPdfDocument;
  circle: (x: number, y: number, radius: number, style?: string) => PreviewPdfDocument;
  rect: (x: number, y: number, width: number, height: number, style?: string) => PreviewPdfDocument;
  addPage: () => PreviewPdfDocument;
  output: (type: "blob") => Blob;
};

function drawPdfCover(doc: PreviewPdfDocument, project: ProjectSnapshot, validation: ProjectValidationResult) {
  drawPdfHeader(doc, project.name, "Samlet sporlæggerark");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`${project.club || "-"} · ${project.eventName || "-"} · ${formatSquareMeters(project.field.areaM2)} · ${formatHectares(project.field.areaM2)}`, 16, 30);

  drawPdfMetric(doc, 16, 42, "Spor", String(project.tracks.length));
  drawPdfMetric(doc, 63, 42, "Status", validation.valid ? "Gyldig" : `${validation.errors.length} fejl`);
  drawPdfMetric(doc, 110, 42, "Kantmargin", formatMeters(project.edgeMarginMeters, 0));
  drawPdfMetric(doc, 157, 42, "Sporafstand", formatMeters(project.minimumTrackSpacingMeters, 0));
  drawPdfOverview(doc, project, { x: 16, y: 68, width: 178, height: 105 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Sporoversigt", 16, 188);
  drawPdfTrackOverviewTable(doc, project, validation, 16, 198);
}

function drawPdfTrackSheetPage(doc: PreviewPdfDocument, project: ProjectSnapshot, validation: ProjectValidationResult, track: Track) {
  const rules = rulesForTrack(project, track);
  const checks = buildTrackRuleChecks(project, track, validation);
  const segmentLengths = calculateSegmentLengths(track.points);
  const turnAngles = calculateTurnAngles(track.points);

  drawPdfHeader(doc, `Sporlæggerark - ${track.name}`, rules.name);
  drawPdfTrackDiagram(doc, track, { x: 16, y: 34, width: 178, height: 78 });

  drawPdfMetric(doc, 16, 122, "Længde", formatMeters(calculateTrackLength(track), 1));
  drawPdfMetric(doc, 63, 122, "Skridt", `${track.lengthSteps}`);
  drawPdfMetric(doc, 110, 122, "Genstande", `${track.objects.length}`);
  drawPdfMetric(doc, 157, 122, "Status", checks.some((check) => check.status === "error") ? "Fejl" : "OK");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Segmenter og knæk", 16, 154);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(segmentLengths.map((length, index) => `${index + 1}: ${formatMeters(length, 1)}`).join("   "), 16, 163, { maxWidth: 178 });
  doc.text(`Knæk: ${turnAngles.map((angle) => `${Math.round(angle)}°`).join("   ") || "-"}`, 16, 171, { maxWidth: 178 });

  doc.setFont("helvetica", "bold");
  doc.text("Genstande", 16, 186);
  doc.setFont("helvetica", "normal");
  track.objects.forEach((object, index) => {
    doc.text(`G${object.displayNo}: ${formatMeters(object.distanceAlongTrackMeters, 1)} fra start · ${object.material}`, 16, 195 + index * 7);
  });

  doc.setFont("helvetica", "bold");
  doc.text("Regelstatus", 104, 186);
  doc.setFont("helvetica", "normal");
  checks.slice(0, 6).forEach((check, index) => {
    doc.setTextColor(check.status === "error" ? "#c92a2a" : check.status === "warning" ? "#9c6b00" : "#2b8a3e");
    doc.text(`${statusLabel(check.status)} · ${check.label}: ${check.value}`, 104, 195 + index * 7, { maxWidth: 90 });
  });
  doc.setTextColor("#16201b");

  doc.setDrawColor("#d7ded7");
  doc.rect(16, 245, 178, 34);
  doc.setFont("helvetica", "bold");
  doc.text("Noter", 20, 254);
  doc.setFont("helvetica", "normal");
  doc.line(20, 263, 190, 263);
  doc.line(20, 273, 190, 273);
}

function drawPdfHeader(doc: PreviewPdfDocument, title: string, subtitle: string) {
  doc.setFillColor("#eef8ee");
  doc.rect(0, 0, 210, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor("#16201b");
  doc.text(title, 16, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor("#34443a");
  doc.text(subtitle, 16, 20);
  doc.setTextColor("#16201b");
}

function drawPdfMetric(doc: PreviewPdfDocument, x: number, y: number, label: string, value: string) {
  doc.setFillColor("#f7faf7");
  doc.setDrawColor("#d7ded7");
  doc.rect(x, y, 37, 18, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor("#637168");
  doc.text(label, x + 3, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor("#16201b");
  doc.text(value, x + 3, y + 14, { maxWidth: 31 });
}

function drawPdfOverview(doc: PreviewPdfDocument, project: ProjectSnapshot, frame: { x: number; y: number; width: number; height: number }) {
  const transform = createPdfProjectTransform(project, frame);
  doc.setFillColor("#f7faf7");
  doc.setDrawColor("#d7ded7");
  doc.rect(frame.x, frame.y, frame.width, frame.height, "FD");
  doc.setDrawColor("#2f6235");
  doc.setLineWidth(0.55);
  drawPdfClosedPolyline(doc, project.field.polygon.map(transform));

  project.restrictedAreas
    .filter((area) => area.active && area.type === "polygon")
    .forEach((area) => {
      if (area.type !== "polygon") return;
      doc.setDrawColor(area.color);
      doc.setLineWidth(0.35);
      drawPdfClosedPolyline(doc, area.polygon.map(transform));
    });

  project.tracks.forEach((track) => {
    doc.setDrawColor(track.color);
    doc.setLineWidth(0.75);
    drawPdfOpenPolyline(doc, track.points.map(transform));
    const start = transform(track.points[0]);
    const finish = transform(track.points[track.points.length - 1]);
    doc.circle(start.x, start.y, 1.4, "S");
    doc.rect(finish.x - 1.1, finish.y - 1.1, 2.2, 2.2);
    doc.setFontSize(6);
    doc.setTextColor(track.color);
    doc.text(String(track.displayNo), start.x + 1.8, start.y - 1.2);
  });
  doc.setTextColor("#16201b");
}

function drawPdfTrackDiagram(doc: PreviewPdfDocument, track: Track, frame: { x: number; y: number; width: number; height: number }) {
  const transform = createPdfPointTransform(track.points, frame);
  doc.setFillColor("#f7faf7");
  doc.setDrawColor("#d7ded7");
  doc.rect(frame.x, frame.y, frame.width, frame.height, "FD");
  doc.setDrawColor(track.color);
  doc.setLineWidth(1);
  drawPdfOpenPolyline(doc, track.points.map(transform));
  const start = transform(track.points[0]);
  const finish = transform(track.points[track.points.length - 1]);
  doc.circle(start.x, start.y, 2, "S");
  doc.rect(finish.x - 1.6, finish.y - 1.6, 3.2, 3.2);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor("#16201b");
  doc.text("Start", start.x + 3, start.y - 2);
  doc.text("Slut", finish.x + 3, finish.y - 2);
  track.objects.forEach((object) => {
    const position = transform(coordinateAtDistance(track.points, object.distanceAlongTrackMeters));
    doc.circle(position.x, position.y, 1.5, "S");
    doc.text(`G${object.displayNo}`, position.x + 2.4, position.y - 1.3);
  });
}

function drawPdfTrackOverviewTable(doc: PreviewPdfDocument, project: ProjectSnapshot, validation: ProjectValidationResult, x: number, y: number) {
  doc.setFontSize(8);
  project.tracks.slice(0, 18).forEach((track, index) => {
    const rowY = y + index * 6;
    const checks = buildTrackRuleChecks(project, track, validation);
    const status = checks.some((check) => check.status === "error") ? "Fejl" : checks.some((check) => check.status === "warning") ? "Obs" : "OK";
    doc.setDrawColor(track.color);
    doc.setLineWidth(1);
    doc.line(x, rowY - 1.2, x + 9, rowY - 1.2);
    doc.setTextColor("#16201b");
    doc.text(`${track.name}`, x + 12, rowY);
    doc.text(`${rulesForTrack(project, track).name}`, x + 55, rowY);
    doc.text(formatMeters(calculateTrackLength(track), 1), x + 112, rowY);
    doc.text(status, x + 150, rowY);
  });
}

function createPdfProjectTransform(project: ProjectSnapshot, frame: { x: number; y: number; width: number; height: number }) {
  const points = [
    ...project.field.polygon,
    ...project.tracks.flatMap((track) => track.points),
    ...project.restrictedAreas.flatMap((area) => (area.type === "polygon" ? area.polygon : []))
  ];
  return createPdfPointTransform(points, frame);
}

function createPdfPointTransform(points: Coordinate[], frame: { x: number; y: number; width: number; height: number }) {
  const bounds = polygonBounds(points);
  const scale = Math.min(frame.width / Math.max(1, bounds.width), frame.height / Math.max(1, bounds.height));
  const xPad = (frame.width - bounds.width * scale) / 2;
  const yPad = (frame.height - bounds.height * scale) / 2;

  return (point: Coordinate): Coordinate => ({
    x: frame.x + xPad + (point.x - bounds.minX) * scale,
    y: frame.y + yPad + (point.y - bounds.minY) * scale
  });
}

function drawPdfOpenPolyline(doc: PreviewPdfDocument, points: Coordinate[]) {
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    doc.line(previous.x, previous.y, point.x, point.y);
  });
}

function drawPdfClosedPolyline(doc: PreviewPdfDocument, points: Coordinate[]) {
  drawPdfOpenPolyline(doc, [...points, points[0]]);
}

function statusLabel(status: RuleStatus): string {
  return status === "ok" ? "OK" : status === "warning" ? "Advarsel" : "Fejl";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rotateProjectField(project: ProjectSnapshot, angleDegrees: number): ProjectSnapshot {
  const origin = polygonCenter(project.field.polygon);
  const polygon = project.field.polygon.map((point) => rotatePoint(point, angleDegrees, origin));
  const areaM2 = calculatePolygonArea(polygon);

  return {
    ...project,
    field: {
      ...project.field,
      polygon,
      areaM2,
      areaHa: areaM2 / 10_000,
      perimeterMeters: calculatePolygonPerimeter(polygon),
      backgroundImage: project.field.backgroundImage ? rotateBackgroundImage(project.field.backgroundImage, angleDegrees, origin) : undefined
    },
    restrictedAreas: project.restrictedAreas.map((area) => {
      if (area.type === "polygon") {
        return { ...area, polygon: area.polygon.map((point) => rotatePoint(point, angleDegrees, origin)) };
      }

      if (area.type === "line") {
        return { ...area, line: area.line.map((point) => rotatePoint(point, angleDegrees, origin)) };
      }

      return { ...area, center: rotatePoint(area.center, angleDegrees, origin) };
    })
  };
}

function rotateBackgroundImage(image: FieldBackgroundImage, angleDegrees: number, origin: Coordinate): FieldBackgroundImage {
  const center = rotatePoint({ x: image.x + image.widthMeters / 2, y: image.y + image.heightMeters / 2 }, angleDegrees, origin);

  return {
    ...image,
    x: center.x - image.widthMeters / 2,
    y: center.y - image.heightMeters / 2,
    rotationDegrees: (image.rotationDegrees + angleDegrees + 360) % 360
  };
}

function polygonCenter(polygon: Coordinate[]): Coordinate {
  const sum = polygon.reduce((accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }), {
    x: 0,
    y: 0
  });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

function formatPolygonInput(polygon: Coordinate[]): string {
  return polygon.map((point) => `${roundForInput(point.x)}, ${roundForInput(point.y)}`).join("\n");
}

function roundForInput(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function parsePolygonInput(input: string): {
  polygon: Coordinate[];
  sourceType: ProjectSnapshot["field"]["sourceType"];
  mapReference?: ProjectSnapshot["field"]["mapReference"];
  projected: boolean;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Indsæt mindst tre polygonpunkter.");
  }

  const rawPoints = trimmed.startsWith("{") || trimmed.startsWith("[") ? pointsFromJson(JSON.parse(trimmed) as unknown) : pointsFromText(trimmed);
  const withoutClosedPoint = dropClosingPoint(rawPoints);

  if (withoutClosedPoint.length < 3) {
    throw new Error("Polygonen skal have mindst tre punkter.");
  }

  const projected = projectLatLonIfDetected(withoutClosedPoint);
  return projected ?? { polygon: withoutClosedPoint, sourceType: "image", projected: false };
}

function pointsFromText(input: string): Coordinate[] {
  return input
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const values = line.split(/[,\t ]+/).filter(Boolean).map(Number);
      if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) {
        throw new Error(`Punktet "${line}" kunne ikke læses.`);
      }
      return { x: values[0], y: values[1] };
    });
}

function pointsFromJson(value: unknown): Coordinate[] {
  if (Array.isArray(value)) {
    return pointsFromArray(value);
  }

  if (isRecord(value)) {
    if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
      const feature = value.features.find((candidate) => isRecord(candidate) && geometryType(candidate.geometry) === "Polygon");
      if (feature && isRecord(feature)) {
        return pointsFromJson(feature.geometry);
      }
    }

    if (value.type === "Feature") {
      return pointsFromJson(value.geometry);
    }

    if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
      return pointsFromArray(value.coordinates[0] as unknown[]);
    }

    if (Array.isArray(value.points)) {
      return pointsFromArray(value.points);
    }

    if (Array.isArray(value.polygon)) {
      return pointsFromArray(value.polygon);
    }
  }

  throw new Error("JSON skal være en liste af punkter eller GeoJSON Polygon.");
}

function pointsFromArray(values: unknown[]): Coordinate[] {
  return values.map((value) => {
    if (Array.isArray(value)) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y };
      }
    }

    if (isRecord(value)) {
      const xValue = value.x ?? value.lon ?? value.lng;
      const yValue = value.y ?? value.lat;
      const x = Number(xValue);
      const y = Number(yValue);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y };
      }
    }

    throw new Error("Et polygonpunkt mangler x/y eller lon/lat.");
  });
}

function geometryType(value: unknown): unknown {
  return isRecord(value) ? value.type : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dropClosingPoint(points: Coordinate[]): Coordinate[] {
  if (points.length < 2) {
    return points;
  }

  const first = points[0];
  const last = points[points.length - 1];
  return Math.abs(first.x - last.x) < 0.000001 && Math.abs(first.y - last.y) < 0.000001 ? points.slice(0, -1) : points;
}

function projectLatLonIfDetected(points: Coordinate[]):
  | {
      polygon: Coordinate[];
      sourceType: ProjectSnapshot["field"]["sourceType"];
      mapReference: ProjectSnapshot["field"]["mapReference"];
      projected: boolean;
    }
  | undefined {
  const lonLat = points.every((point) => point.x >= 7 && point.x <= 16 && point.y >= 54 && point.y <= 58.5);
  const latLon = points.every((point) => point.y >= 7 && point.y <= 16 && point.x >= 54 && point.x <= 58.5);

  if (!lonLat && !latLon) {
    return undefined;
  }

  const latLonPoints = points.map((point) => (lonLat ? { lat: point.y, lon: point.x } : { lat: point.x, lon: point.y }));
  const center = centerOf(latLonPoints);
  const mapReference = createMapReference({ centerLat: center.lat, centerLon: center.lon, zoom: 17, address: "Indsat polygon" });
  return {
    polygon: latLonPoints.map((point) => latLonToLocalMeters(point, mapReference)),
    sourceType: "map",
    mapReference,
    projected: true
  };
}

function createProjectedMapPolygon(points: GeocodeResult[], address: string, zoom: number, rotationDegrees: number) {
  const center = centerOf(points);
  const mapReference = createMapReference({ centerLat: center.lat, centerLon: center.lon, zoom, address });
  const rawPolygon = points.map((point) => latLonToLocalMeters(point, mapReference));
  const origin = polygonCenter(rawPolygon);
  const polygon = rotationDegrees === 0 ? rawPolygon : rawPolygon.map((point) => rotatePoint(point, rotationDegrees, origin));
  const areaM2 = calculatePolygonArea(polygon);

  return {
    mapReference,
    polygon,
    areaM2,
    perimeterMeters: calculatePolygonPerimeter(polygon)
  };
}

function scalePolygon(polygon: Coordinate[], scale: number): Coordinate[] {
  const center = polygon.reduce((accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }), { x: 0, y: 0 });
  const origin = { x: center.x / polygon.length, y: center.y / polygon.length };

  return polygon.map((point) => ({
    x: origin.x + (point.x - origin.x) * scale,
    y: origin.y + (point.y - origin.y) * scale
  }));
}

function pointToSvg(point: Coordinate): string {
  return `${point.x},${point.y}`;
}

function centerOf(points: { lat: number; lon: number }[]): { lat: number; lon: number } {
  const sum = points.reduce((accumulator, point) => ({ lat: accumulator.lat + point.lat, lon: accumulator.lon + point.lon }), {
    lat: 0,
    lon: 0
  });
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Billedets dimensioner kunne ikke læses."));
    };
    image.src = url;
  });
}

function downloadBlob(content: string | Blob, fileName: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
