"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Copy,
  Crop,
  Download,
  FileCheck2,
  FlipHorizontal2,
  ImageUp,
  Layers,
  MapPinned,
  MousePointer2,
  Move,
  Plus,
  Redo2,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import type {
  CalibrationMethod,
  Coordinate,
  FieldBackgroundImage,
  PlacementOptions,
  PlacementResult,
  ProjectSnapshot,
  ProjectValidationResult,
  Track,
  TrackTemplateRules,
  TurnDirection,
  ValidationMessage
} from "@/domain/types";
import { projectToGeoJson, projectToSvg } from "@/domain/export/exporters";
import { dchTrackTemplates } from "@/domain/rules/templates";
import { createTrackFromShape } from "@/domain/track/create-track";
import { calibrateByDimensions, calibrateByDistance, calibrateByKnownArea } from "@/geometry/calibration";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";
import { polygonBounds } from "@/geometry/polygons";
import { calculateSegmentLengths, calculateTrackLength, calculateTurnAngles, coordinateAtDistance } from "@/geometry/polylines";
import { rotateTrack } from "@/geometry/transforms";
import { validateProject } from "@/domain/validation/validation";
import { useEditorStore } from "@/stores/editor-store";
import { parseAreaInputToM2, formatHectares, formatMeters, formatSquareMeters } from "@/utils/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DragState =
  | { type: "track"; trackId: string; last: Coordinate }
  | { type: "point"; trackId: string; pointIndex: number }
  | { type: "pan"; lastClient: Coordinate }
  | undefined;

type ApiResponse<T> = { success: true; data: T } | { success: false; error: { code: string; message: string } };
type LayerState = {
  background: boolean;
  grid: boolean;
  field: boolean;
  obstacles: boolean;
  tracks: boolean;
};
type ContextMenuState = { x: number; y: number; trackId: string } | undefined;
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
type FocusTarget = { position: Coordinate; label: string; trackId?: string } | undefined;
type TrackProfile = {
  code: string;
  label: string;
  prefix: string;
  template: TrackTemplateRules;
  segmentLengthsMeters: number[];
  turnAnglesDegrees: number[];
  turnDirections: TurnDirection[];
};
type PlacementReport = {
  result: PlacementResult;
  mode: "requested" | "maximum" | "mixed";
  directionDegrees: number;
  triedDirections: number[];
  summary: string;
};

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

export function EditorShell({ initialProject }: { initialProject: ProjectSnapshot }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const placementAbortRef = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState<DragState>();
  const [validation, setValidation] = useState<ProjectValidationResult>(() => validateProject(initialProject));
  const [placement, setPlacement] = useState<PlacementResult>();
  const [placementStage, setPlacementStage] = useState("");
  const [placementRunning, setPlacementRunning] = useState(false);
  const [areaInput, setAreaInput] = useState("28.310 m²");
  const [calibrationMethod, setCalibrationMethod] = useState<CalibrationMethod>("area");
  const [knownDistanceInput, setKnownDistanceInput] = useState("50");
  const [knownWidthInput, setKnownWidthInput] = useState("200");
  const [knownHeightInput, setKnownHeightInput] = useState("140");
  const [calibrationStatus, setCalibrationStatus] = useState("");
  const [draftCalibrationPoints, setDraftCalibrationPoints] = useState<Coordinate[]>([]);
  const [uploadStatus, setUploadStatus] = useState("Intet billede indlæst");
  const [mousePosition, setMousePosition] = useState<Coordinate>({ x: 0, y: 0 });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [snapStep, setSnapStep] = useState(5);
  const [snapToRightAngle, setSnapToRightAngle] = useState(true);
  const [layers, setLayers] = useState<LayerState>({ background: true, grid: true, field: true, obstacles: true, tracks: true });
  const [hiddenTrackIds, setHiddenTrackIds] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [panOffset, setPanOffset] = useState<Coordinate>({ x: 0, y: 0 });
  const [activeTemplateCode, setActiveTemplateCode] = useState("DCH_B");
  const [autoDirectionDegrees, setAutoDirectionDegrees] = useState(0);
  const [autoKeepExisting, setAutoKeepExisting] = useState(false);
  const [mixedCounts, setMixedCounts] = useState<Record<string, number>>({ DCH_B: 2, DCH_A: 0, DCH_E: 0 });
  const [rotationNudgeDegrees, setRotationNudgeDegrees] = useState(2.5);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>();
  const [placementReport, setPlacementReport] = useState<PlacementReport>();
  const {
    project,
    selectedTrackId,
    selectedTrackIds,
    selectedPointIndex,
    tool,
    draftPolygon,
    zoom,
    saveStatus,
    setProject,
    setTool,
    setSaveStatus,
    selectTrack,
    commitProject,
    addDraftPoint,
    finishFieldPolygon,
    translateSelectedTrack,
    rotateSelectedTrack,
    mirrorSelectedTrack,
    reverseSelectedTrack,
    duplicateSelectedTrack,
    deleteSelectedTrack,
    moveTrackPoint,
    updateFieldBackgroundImage,
    updateFieldCalibration,
    addRestrictedAreaAt,
    updateProjectMeta,
    undo,
    redo,
    setZoom
  } = useEditorStore();
  const activeProfile = resolveTrackProfile(activeTemplateCode, project);
  const fieldAngleDegrees = useMemo(() => fieldPrimaryAngle(project.field.polygon), [project.field.polygon]);
  const suggestedTrackCount = useMemo(() => estimateTrackCapacity(project, activeProfile.template), [
    activeProfile.template,
    project.edgeMarginMeters,
    project.field.areaM2,
    project.field.perimeterMeters,
    project.field.polygon,
    project.minimumTrackSpacingMeters
  ]);

  useEffect(() => {
    setProject(initialProject);
  }, [initialProject, setProject]);

  useEffect(() => {
    setValidation(validateProject(project));
  }, [project]);

  useEffect(() => {
    if (saveStatus !== "Ikke gemt") {
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = setTimeout(() => {
      setSaveStatus("Gemmer ...");
      fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: project })
      })
        .then(async (response) => {
          const payload = (await response.json()) as ApiResponse<ProjectSnapshot>;
          if (!response.ok || !payload.success) {
            throw new Error(payload.success ? "Gemning fejlede." : payload.error.message);
          }
          setSaveStatus("Gemt");
        })
        .catch(() => setSaveStatus("Kunne ikke gemme"));
    }, 750);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [project, saveStatus, setSaveStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelectedTrack();
      }
      if (meta && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedTrack();
      } else if (event.key.toLowerCase() === "r") {
        rotateSelectedTrack(15);
      } else if (event.key.toLowerCase() === "m") {
        mirrorSelectedTrack();
      } else if (event.key.toLowerCase() === "f") {
        setZoom(1);
      } else if (event.key === "Escape") {
        setTool("select");
        selectTrack(undefined);
        setDraftCalibrationPoints([]);
        setContextMenu(undefined);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    deleteSelectedTrack,
    duplicateSelectedTrack,
    mirrorSelectedTrack,
    redo,
    rotateSelectedTrack,
    selectTrack,
    setTool,
    setZoom,
    undo
  ]);

  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId);
  const visibleTracks = useMemo(
    () => project.tracks.filter((track) => !hiddenTrackIds.includes(track.id)),
    [hiddenTrackIds, project.tracks]
  );
  const viewBox = useMemo(() => calculateViewBox(project, zoom, panOffset), [panOffset, project, zoom]);
  const viewBoxParts = useMemo(() => viewBox.split(" ").map(Number), [viewBox]);
  const validationMessages = useMemo(() => [...validation.errors, ...validation.warnings], [validation]);
  const selectedTrackRuleChecks = useMemo(
    () => (selectedTrack ? buildTrackRuleChecks(project, selectedTrack, validation) : []),
    [project, selectedTrack, validation]
  );
  const backgroundImage = project.field.backgroundImage;
  const backgroundCrop = useMemo(() => (backgroundImage ? cropRectForBackground(backgroundImage) : undefined), [backgroundImage]);

  const toWorld = useCallback((event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) {
      return { x: 0, y: 0 };
    }

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) {
      return { x: 0, y: 0 };
    }

    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const snapWorldPoint = useCallback(
    (point: Coordinate): Coordinate => {
      if (!snapToGrid || snapStep <= 0) return point;
      return {
        x: Math.round(point.x / snapStep) * snapStep,
        y: Math.round(point.y / snapStep) * snapStep
      };
    },
    [snapStep, snapToGrid]
  );

  function addTrackAtPoint(point: Coordinate) {
    const displayNo = project.tracks.length + 1;
    const track = createTrackFromShape(
      createClientTrackId(),
      displayNo,
      point,
      displayNo % 2 === 0 ? 180 : 0,
      activeProfile.template,
      activeProfile,
      activeProfile.prefix
    );
    commitProject({ ...withActiveTemplate(project, activeProfile.template), tracks: [...project.tracks, track] });
    selectTrack(track.id);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const rawPoint = toWorld(event);
    const point = snapWorldPoint(rawPoint);
    setMousePosition(point);
    setContextMenu(undefined);

    if (tool === "pan") {
      setDragging({ type: "pan", lastClient: { x: event.clientX, y: event.clientY } });
      return;
    }

    if (tool === "draw-field") {
      addDraftPoint(point);
      return;
    }

    if (tool === "calibrate-distance") {
      setDraftCalibrationPoints((current) => (current.length >= 2 ? [point] : [...current, point]));
      setCalibrationStatus("Kalibreringspunkt valgt.");
      return;
    }

    if (tool === "add-track") {
      addTrackAtPoint(point);
      return;
    }

    if (tool === "add-obstacle") {
      addRestrictedAreaAt(point);
      setTool("select");
      return;
    }

    selectTrack(undefined);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rawPoint = toWorld(event);
    const point = snapWorldPoint(rawPoint);
    setMousePosition(point);

    if (!dragging) {
      return;
    }

    if (dragging.type === "pan") {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const width = viewBoxParts[2] ?? 1;
      const height = viewBoxParts[3] ?? 1;
      const dx = ((event.clientX - dragging.lastClient.x) / Math.max(1, rect.width)) * width;
      const dy = ((event.clientY - dragging.lastClient.y) / Math.max(1, rect.height)) * height;
      setPanOffset((current) => ({ x: current.x - dx, y: current.y - dy }));
      setDragging({ type: "pan", lastClient: { x: event.clientX, y: event.clientY } });
      return;
    }

    if (dragging.type === "track") {
      translateSelectedTrack(point.x - dragging.last.x, point.y - dragging.last.y);
      setDragging({ ...dragging, last: point });
      return;
    }

    if (snapToRightAngle) {
      moveTrackPoint(dragging.trackId, dragging.pointIndex, point);
      return;
    }

    commitProject({
      ...project,
      tracks: project.tracks.map((track) =>
        track.id === dragging.trackId
          ? {
              ...track,
              points: track.points.map((candidate, index) => (index === dragging.pointIndex ? rawPoint : candidate))
            }
          : track
      )
    });
  }

  function handlePointerUp() {
    setDragging(undefined);
  }

  async function handleServerValidation() {
    const response = await fetch(`/api/projects/${project.id}/validate`, { method: "POST" });
    const payload = (await response.json()) as ApiResponse<ProjectValidationResult>;
    if (payload.success) {
      setValidation(payload.data);
    }
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

    return {
      result: { ...best.result, tracks: relabelTracks(best.result.tracks) },
      mode,
      directionDegrees: best.directionDegrees,
      triedDirections: directions,
      summary: summarizeRejectedReasons(best.result.rejectedReasons) || "Alle valgte spor kunne placeres uden regelbrud."
    };
  }

  async function handleAutoPlacement(mode: PlacementReport["mode"] = "requested") {
    if (placementRunning) {
      return;
    }

    const controller = new AbortController();
    placementAbortRef.current = controller;
    setPlacementRunning(true);
    setPlacementStage(mode === "maximum" ? "Finder maks antal lovlige spor ..." : "Prøver flere retninger ...");

    try {
      await wait(40);
      if (controller.signal.aborted) return;
      const requestedTrackCount = mode === "maximum" ? 1000 : project.requestedTrackCount;
      const fixedTracks = autoKeepExisting ? project.tracks : [];
      const placementProject = withActiveTemplate({ ...project, requestedTrackCount }, activeProfile.template);
      const report = findBestPlacement(placementProject, requestedTrackCount, fixedTracks, mode);
      setPlacement(report.result);
      setPlacementReport(report);
      commitProject({ ...placementProject, tracks: report.result.tracks });
      setPlacementStage(
        mode === "maximum"
          ? `${report.result.placedTrackCount} nye spor fundet som maks · retning ${formatDegrees(report.directionDegrees)}`
          : `${report.result.placedTrackCount}/${report.result.requestedTrackCount} nye spor placeret · retning ${formatDegrees(report.directionDegrees)}`
      );
    } catch (error) {
      setPlacementStage(error instanceof DOMException && error.name === "AbortError" ? "Annulleret" : "Placering fejlede");
    } finally {
      setPlacementRunning(false);
      placementAbortRef.current = null;
    }
  }

  async function handleMixedPlacement() {
    if (placementRunning) {
      return;
    }

    const entries = trackProfiles
      .map((profile) => ({ profile, count: normalizeOptionalTrackCount(Number(mixedCounts[profile.code] ?? 0)) }))
      .filter((entry) => entry.count > 0);

    if (entries.length === 0) {
      setPlacementStage("Vælg mindst én B/A/E-type til mix.");
      return;
    }

    setPlacementRunning(true);
    setPlacementStage("Autoplacerer B/A/E-mix ...");

    try {
      await wait(40);
      let placed = autoKeepExisting ? relabelTracks(project.tracks) : [];
      let nextProject = { ...project, tracks: placed, templates: project.templates ?? dchTrackTemplates };
      const summaries: string[] = [];

      entries.forEach(({ profile, count }) => {
        const resolvedProfile = resolveTrackProfile(profile.code, nextProject);
        const placementProject = withActiveTemplate({ ...nextProject, requestedTrackCount: count }, resolvedProfile.template);
        const report = findBestPlacement(placementProject, count, placed, "mixed");
        placed = relabelTracks(report.result.tracks);
        nextProject = { ...placementProject, tracks: placed, templates: placementProject.templates ?? dchTrackTemplates };
        summaries.push(
          report.result.placedTrackCount < count
            ? `${resolvedProfile.label}: ${report.result.placedTrackCount}/${count} (${report.summary})`
            : `${resolvedProfile.label}: ${report.result.placedTrackCount}/${count}`
        );
      });

      const result: PlacementResult = {
        labelDa: "Bedste fundne forslag",
        tracks: placed,
        requestedTrackCount: entries.reduce((sum, entry) => sum + entry.count, 0),
        placedTrackCount: placed.length - (autoKeepExisting ? project.tracks.length : 0),
        durationMs: 1,
        score: placed.length,
        candidatesEvaluated: 0,
        rejectedReasons: {}
      };
      setPlacement(result);
      setPlacementReport({
        result,
        mode: "mixed",
        directionDegrees: autoDirectionDegrees,
        triedDirections: [],
        summary: summaries.join(" · ")
      });
      commitProject({ ...nextProject, tracks: placed });
      setPlacementStage(`Mix placeret: ${summaries.join(" · ")}`);
    } finally {
      setPlacementRunning(false);
    }
  }

  function cancelAutoPlacement() {
    placementAbortRef.current?.abort();
    setPlacementRunning(false);
    setPlacementStage("Annulleret");
  }

  async function handleUpload(file?: File) {
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setUploadStatus("Uploader ...");
    const response = await fetch("/api/uploads/field-image", { method: "POST", body: formData });
    const payload = (await response.json()) as ApiResponse<{ originalName: string; mimeType: string; byteSize: number; storageKey: string }>;
    if (!payload.success) {
      setUploadStatus(payload.error.message);
      return;
    }

    const dimensions = await readImageDimensions(file);
    const bounds = polygonBounds(project.field.polygon);
    const image: FieldBackgroundImage = {
      originalName: payload.data.originalName,
      mimeType: payload.data.mimeType,
      byteSize: payload.data.byteSize,
      storageKey: payload.data.storageKey,
      url: `/api/uploads/field-image/${payload.data.storageKey}`,
      widthPixels: dimensions.width,
      heightPixels: dimensions.height,
      x: bounds.minX,
      y: bounds.minY,
      widthMeters: bounds.width || dimensions.width,
      heightMeters: bounds.height || dimensions.height,
      rotationDegrees: 0,
      opacity: 0.48,
      crop: {
        topPercent: 0,
        rightPercent: 0,
        bottomPercent: 0,
        leftPercent: 0
      }
    };

    updateFieldBackgroundImage(image);
    setUploadStatus(`${payload.data.originalName} er kontrolleret, gemt privat og lagt under planen`);
  }

  function applyAreaInput() {
    const areaM2 = parseAreaInputToM2(areaInput);
    const calibration = calibrateByKnownArea(project.field.polygon, areaM2);
    updateFieldCalibration(calibration, areaM2);
    setCalibrationStatus("Arealbaseret kalibrering er anvendt.");
  }

  function applyCalibration() {
    try {
      if (calibrationMethod === "area") {
        applyAreaInput();
        return;
      }

      if (calibrationMethod === "distance") {
        if (draftCalibrationPoints.length !== 2) {
          setCalibrationStatus("Vælg to punkter på tegnefladen først.");
          return;
        }
        const calibration = calibrateByDistance(draftCalibrationPoints[0], draftCalibrationPoints[1], Number(knownDistanceInput));
        updateFieldCalibration(calibration);
        setCalibrationStatus("Afstandskalibrering er anvendt.");
        return;
      }

      if (!backgroundImage) {
        setCalibrationStatus("Upload et markbillede før bredde/højde-kalibrering.");
        return;
      }

      const visibleWidthPixels = backgroundImage.widthPixels * (1 - backgroundImage.crop.leftPercent / 100 - backgroundImage.crop.rightPercent / 100);
      const visibleHeightPixels = backgroundImage.heightPixels * (1 - backgroundImage.crop.topPercent / 100 - backgroundImage.crop.bottomPercent / 100);
      const widthMeters = Number(knownWidthInput);
      const heightMeters = Number(knownHeightInput);
      const calibration = calibrateByDimensions(visibleWidthPixels, visibleHeightPixels, widthMeters, heightMeters);
      commitProject({
        ...project,
        field: {
          ...project.field,
          backgroundImage: {
            ...backgroundImage,
            widthMeters,
            heightMeters
          },
          calibration
        }
      });
      setCalibrationStatus("Bredde/højde-kalibrering er anvendt.");
    } catch (error) {
      setCalibrationStatus(error instanceof Error ? error.message : "Kalibrering fejlede.");
    }
  }

  async function saveFieldVariant() {
    setPlacementStage("Gemmer markvariant ...");
    const response = await fetch(`/api/projects/${project.id}/versions`, { method: "POST" });
    setPlacementStage(response.ok ? "Markvariant gemt i versionshistorikken" : "Kunne ikke gemme markvariant");
  }

  function downloadProject(format: "json" | "svg" | "geojson") {
    const content =
      format === "json"
        ? JSON.stringify(project, null, 2)
        : format === "svg"
          ? projectToSvg(project)
          : JSON.stringify(projectToGeoJson(project), null, 2);
    downloadBlob(content, `${project.name}.${format === "json" ? "project.json" : format}`, format === "svg" ? "image/svg+xml" : "application/json");
  }

  async function exportPng() {
    const svg = projectToSvg(project, { width: 1600, height: 1000 });
    const image = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#f7faf7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `${project.name}.png`, "image/png");
      }
    });
  }

  function updateBackgroundPatch(patch: Partial<FieldBackgroundImage>) {
    if (!backgroundImage) return;
    updateFieldBackgroundImage({ ...backgroundImage, ...patch });
  }

  function updateBackgroundCrop(edge: keyof FieldBackgroundImage["crop"], value: number) {
    if (!backgroundImage) return;
    updateFieldBackgroundImage({
      ...backgroundImage,
      crop: {
        ...backgroundImage.crop,
        [edge]: Math.min(45, Math.max(0, value))
      }
    });
  }

  function fitBackgroundToField() {
    if (!backgroundImage) return;
    const bounds = polygonBounds(project.field.polygon);
    updateFieldBackgroundImage({
      ...backgroundImage,
      x: bounds.minX,
      y: bounds.minY,
      widthMeters: bounds.width || backgroundImage.widthMeters,
      heightMeters: bounds.height || backgroundImage.heightMeters
    });
  }

  function toggleLayer(key: keyof LayerState) {
    setLayers((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleTrackVisibility(trackId: string) {
    setHiddenTrackIds((current) => (current.includes(trackId) ? current.filter((id) => id !== trackId) : [...current, trackId]));
  }

  function focusContextTrack(trackId: string) {
    selectTrack(trackId);
    setContextMenu(undefined);
  }

  function contextDuplicate(trackId: string) {
    selectTrack(trackId);
    duplicateSelectedTrack();
    setContextMenu(undefined);
  }

  function contextMirror(trackId: string) {
    selectTrack(trackId);
    mirrorSelectedTrack();
    setContextMenu(undefined);
  }

  function contextDelete(trackId: string) {
    selectTrack(trackId);
    deleteSelectedTrack();
    setContextMenu(undefined);
  }

  function selectedIds(): string[] {
    return selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
  }

  function rotateSelectedAroundCenter(angleDegrees: number, label: string) {
    const selected = selectedIds();
    if (selected.length === 0) return;
    commitProject({
      ...project,
      tracks: project.tracks.map((track) => (selected.includes(track.id) ? rotateTrack(track, angleDegrees, trackCenter(track)) : track))
    });
    setPlacementStage(label);
  }

  function alignSelectedToField() {
    const selected = selectedIds();
    if (selected.length === 0) return;
    commitProject({
      ...project,
      tracks: project.tracks.map((track) =>
        selected.includes(track.id) ? rotateTrack(track, signedAngleDelta(track.rotationDegrees, fieldAngleDegrees), trackCenter(track)) : track
      )
    });
    setPlacementStage(`Markerede spor rettet til markretning ${formatDegrees(fieldAngleDegrees)}`);
  }

  function focusRule(check: RuleCheck) {
    if (check.trackId) {
      selectTrack(check.trackId);
    }

    if (!check.position) {
      setPlacementStage(check.detail);
      return;
    }

    setFocusTarget({ position: check.position, label: check.label, trackId: check.trackId });
    const nextZoom = Math.max(1.8, zoom);
    setZoom(nextZoom);
    setPanOffset(panOffsetForPoint(project, nextZoom, check.position));
    setPlacementStage(check.detail);
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f7f4] text-ink-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase text-field-700">DcH Sporplanlægger</p>
          <h1 className="text-xl font-semibold">{project.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={saveStatus === "Gemt" ? "ok" : saveStatus === "Kunne ikke gemme" ? "error" : "warning"}>
            {saveStatus}
          </Badge>
          <Button variant="ghost" icon={<Undo2 size={16} />} onClick={undo} title="Fortryd" aria-label="Fortryd" />
          <Button variant="ghost" icon={<Redo2 size={16} />} onClick={redo} title="Gentag" aria-label="Gentag" />
          <Button icon={<FileCheck2 size={16} />} onClick={handleServerValidation}>
            Validér
          </Button>
          <Link href={`/projects/${project.id}/map`} className="inline-flex">
            <Button icon={<MapPinned size={16} />}>Kort</Button>
          </Link>
          <Link href={`/projects/${project.id}/settings`} className="inline-flex">
            <Button icon={<Layers size={16} />}>Indstillinger</Button>
          </Link>
          <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => void handleAutoPlacement("requested")} disabled={placementRunning}>
            Automatisk placering
          </Button>
          {placementRunning ? (
            <Button variant="danger" icon={<X size={16} />} onClick={cancelAutoPlacement}>
              Annullér
            </Button>
          ) : null}
          <a href={`/api/projects/${project.id}/export?format=pdf`} className="inline-flex">
            <Button icon={<Download size={16} />}>PDF</Button>
          </a>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_330px]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Projekt</h2>
            <label className="block text-xs font-medium text-ink-700">
              Projektnavn
              <Input value={project.name} onChange={(event) => updateProjectMeta({ name: event.target.value })} />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Klub
              <Input value={project.club} onChange={(event) => updateProjectMeta({ club: event.target.value })} />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Arrangement
              <Input value={project.eventName} onChange={(event) => updateProjectMeta({ eventName: event.target.value })} />
            </label>
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Mark</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-field-50 p-3">
                <p className="text-xs text-ink-500">Areal</p>
                <p className="font-semibold">{formatSquareMeters(project.field.areaM2)}</p>
              </div>
              <div className="rounded-md bg-field-50 p-3">
                <p className="text-xs text-ink-500">Hektar</p>
                <p className="font-semibold">{formatHectares(project.field.areaM2)}</p>
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-ink-500">Markretning</p>
                  <p className="font-semibold">{formatDegrees(fieldAngleDegrees)}</p>
                </div>
                <Button onClick={() => void saveFieldVariant()}>Gem markvariant</Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Input value={areaInput} onChange={(event) => setAreaInput(event.target.value)} aria-label="Kendt markareal" />
              <Button onClick={applyAreaInput}>Brug</Button>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-3 gap-1 rounded-md bg-white p-1">
                {(["area", "distance", "dimensions"] as CalibrationMethod[]).map((method) => (
                  <button
                    key={method}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium",
                      calibrationMethod === method ? "bg-field-700 text-white" : "text-ink-600 hover:bg-field-50"
                    )}
                    onClick={() => {
                      setCalibrationMethod(method);
                      if (method === "distance") setTool("calibrate-distance");
                    }}
                  >
                    {method === "area" ? "Areal" : method === "distance" ? "Afstand" : "B/H"}
                  </button>
                ))}
              </div>
              {calibrationMethod === "distance" ? (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-medium text-ink-700">
                    Kendt afstand i meter
                    <Input value={knownDistanceInput} onChange={(event) => setKnownDistanceInput(event.currentTarget.value)} />
                  </label>
                  <p className="text-xs text-ink-500">{draftCalibrationPoints.length}/2 punkter valgt på tegnefladen.</p>
                </div>
              ) : null}
              {calibrationMethod === "dimensions" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="block text-xs font-medium text-ink-700">
                    Bredde
                    <Input value={knownWidthInput} onChange={(event) => setKnownWidthInput(event.currentTarget.value)} />
                  </label>
                  <label className="block text-xs font-medium text-ink-700">
                    Højde
                    <Input value={knownHeightInput} onChange={(event) => setKnownHeightInput(event.currentTarget.value)} />
                  </label>
                </div>
              ) : null}
              <Button className="mt-3 w-full" onClick={applyCalibration}>
                Anvend kalibrering
              </Button>
              <p className="mt-2 text-xs text-ink-500">
                {calibrationStatus ||
                  (project.field.calibration
                    ? `${project.field.calibration.method} · ${project.field.calibration.meterPerPixel.toFixed(4)} m/px`
                    : "Ingen kalibrering anvendt.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={tool === "draw-field" ? "primary" : "secondary"}
                icon={<MousePointer2 size={16} />}
                onClick={() => setTool("draw-field")}
              >
                Tegn markpolygon
              </Button>
              <Button onClick={finishFieldPolygon} disabled={draftPolygon.length < 3}>
                Afslut polygon
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
              <ImageUp size={16} />
              <span>Upload markbillede</span>
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void handleUpload(event.target.files?.[0])}
              />
            </label>
            <p className="text-xs text-ink-500">{uploadStatus}</p>
            {backgroundImage ? (
              <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold">{backgroundImage.originalName}</p>
                  <Button variant="ghost" icon={<X size={14} />} onClick={() => updateFieldBackgroundImage(undefined)} aria-label="Fjern billede" />
                </div>
                <label className="block text-xs font-medium text-ink-700">
                  Rotation {backgroundImage.rotationDegrees}°
                  <input
                    className="w-full accent-field-700"
                    type="range"
                    min={-180}
                    max={180}
                    value={backgroundImage.rotationDegrees}
                    onChange={(event) => updateBackgroundPatch({ rotationDegrees: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="block text-xs font-medium text-ink-700">
                  Opacitet {Math.round(backgroundImage.opacity * 100)}%
                  <input
                    className="w-full accent-field-700"
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={backgroundImage.opacity}
                    onChange={(event) => updateBackgroundPatch({ opacity: Number(event.currentTarget.value) })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["leftPercent", "Venstre"],
                    ["rightPercent", "Højre"],
                    ["topPercent", "Top"],
                    ["bottomPercent", "Bund"]
                  ].map(([key, label]) => (
                    <label key={key} className="text-xs font-medium text-ink-700">
                      <span className="flex items-center gap-1">
                        <Crop size={12} /> {label}
                      </span>
                      <Input
                        type="number"
                        min={0}
                        max={45}
                        value={backgroundImage.crop[key as keyof FieldBackgroundImage["crop"]]}
                        onChange={(event) => updateBackgroundCrop(key as keyof FieldBackgroundImage["crop"], Number(event.currentTarget.value))}
                      />
                    </label>
                  ))}
                </div>
                <Button className="w-full" onClick={fitBackgroundToField}>
                  Tilpas til mark
                </Button>
              </div>
            ) : null}
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Spor</h2>
            <label className="block text-xs font-medium text-ink-700">
              Sportype
              <select
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                value={activeTemplateCode}
                onChange={(event) => setActiveTemplateCode(event.currentTarget.value)}
              >
                {trackProfiles.map((profile) => (
                  <option key={profile.code} value={profile.code}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button variant={tool === "pan" ? "primary" : "secondary"} icon={<Move size={16} />} onClick={() => setTool("pan")}>
                Panorér
              </Button>
              <Button variant={tool === "add-track" ? "primary" : "secondary"} icon={<Plus size={16} />} onClick={() => setTool("add-track")}>
                Tilføj {activeProfile.label}
              </Button>
              <Button icon={<Layers size={16} />} onClick={() => setTool("add-obstacle")}>
                Forbudt område
              </Button>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold uppercase text-ink-500">Snap</h3>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={snapToGrid} onChange={(event) => setSnapToGrid(event.currentTarget.checked)} />
                Grid
              </label>
              <label className="mt-2 block text-xs font-medium text-ink-700">
                Gridstørrelse
                <Input type="number" min={1} value={snapStep} onChange={(event) => setSnapStep(Number(event.currentTarget.value))} />
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={snapToRightAngle} onChange={(event) => setSnapToRightAngle(event.currentTarget.checked)} />
                Fasthold 90° knæk ved punktflyt
              </label>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold uppercase text-ink-500">Lag</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                {[
                  ["background", "Billede"],
                  ["grid", "Grid"],
                  ["field", "Mark"],
                  ["obstacles", "Forbud"],
                  ["tracks", "Spor"]
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={layers[key as keyof LayerState]}
                      onChange={() => toggleLayer(key as keyof LayerState)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-xs font-medium text-ink-700">
              Ønsket antal spor
              <Input
                type="number"
                min={1}
                max={1000}
                value={project.requestedTrackCount}
                onChange={(event) =>
                  useEditorStore.getState().commitProject({
                    ...project,
                    requestedTrackCount: normalizeTrackCount(Number(event.currentTarget.value))
                  })
                }
              />
            </label>
            <div className="rounded-md border border-field-200 bg-field-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-field-700">Forslag ud fra markareal</p>
                  <p className="font-semibold text-ink-900">{suggestedTrackCount} spor</p>
                </div>
                <Button
                  onClick={() =>
                    useEditorStore.getState().commitProject({
                      ...project,
                      requestedTrackCount: suggestedTrackCount
                    })
                  }
                >
                  Brug
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" icon={<Sparkles size={16} />} onClick={() => void handleAutoPlacement("requested")} disabled={placementRunning}>
                Autoplacer valgt
              </Button>
              <Button icon={<Sparkles size={16} />} onClick={() => void handleAutoPlacement("maximum")} disabled={placementRunning}>
                Placer maks
              </Button>
            </div>
            <label className="block text-xs font-medium text-ink-700">
              Auto-retning
              <Input
                type="number"
                step={1}
                value={autoDirectionDegrees}
                onChange={(event) => setAutoDirectionDegrees(normalizeDegrees(Number(event.currentTarget.value) || 0))}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setAutoDirectionDegrees(fieldAngleDegrees)}>Brug markretning {formatDegrees(fieldAngleDegrees)}</Button>
              <Button onClick={() => setPlacementStage(`Markens primære retning er ${formatDegrees(fieldAngleDegrees)}`)}>Vis markretning</Button>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <input type="checkbox" checked={autoKeepExisting} onChange={(event) => setAutoKeepExisting(event.currentTarget.checked)} />
              Behold eksisterende spor og læg nye udenom
            </label>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold uppercase text-ink-500">B/A/E-mix</h3>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {trackProfiles.map((profile) => (
                  <label key={profile.code} className="block text-xs font-medium text-ink-700">
                    {profile.label}
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={mixedCounts[profile.code] ?? 0}
                      onChange={(event) => {
                        const nextCount = normalizeOptionalTrackCount(Number(event.currentTarget.value));
                        setMixedCounts((current) => ({ ...current, [profile.code]: nextCount }));
                      }}
                    />
                  </label>
                ))}
              </div>
              <Button className="mt-3 w-full" variant="primary" onClick={() => void handleMixedPlacement()} disabled={placementRunning}>
                Autoplacer mix
              </Button>
            </div>
            <label className="block text-xs font-medium text-ink-700">
              Kantmargin
              <Input
                type="number"
                min={0}
                value={project.edgeMarginMeters}
                onChange={(event) =>
                  useEditorStore.getState().commitProject({
                    ...project,
                    edgeMarginMeters: Number(event.currentTarget.value)
                  })
                }
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Minimumafstand mellem spor
              <Input
                type="number"
                min={0}
                value={project.minimumTrackSpacingMeters}
                onChange={(event) =>
                  useEditorStore.getState().commitProject({
                    ...project,
                    minimumTrackSpacingMeters: Number(event.currentTarget.value)
                  })
                }
              />
            </label>
            <div className="space-y-2">
              {selectedTrackIds.length > 1 ? (
                <p className="rounded-md bg-field-50 p-2 text-xs text-field-800">{selectedTrackIds.length} spor markeret.</p>
              ) : null}
              {project.tracks.map((track) => (
                <button
                  key={track.id}
                  className={cn(
                    "grid w-full grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                    selectedTrackIds.includes(track.id) ? "border-field-700 bg-field-50" : "border-slate-200 bg-white"
                  )}
                  onClick={(event) => selectTrack(track.id, undefined, event.shiftKey || event.metaKey || event.ctrlKey)}
                >
                  <span className="flex items-center gap-2">
                    <svg className="h-3 w-3 rounded-sm" viewBox="0 0 12 12" aria-hidden="true">
                      <rect width="12" height="12" rx="2" fill={track.color} />
                    </svg>
                    {track.name}
                  </span>
                  <span className="text-xs text-ink-500">{formatMeters(track.lengthMeters, 0)}</span>
                  <span
                    className="rounded border border-slate-200 px-2 py-1 text-xs text-ink-500"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleTrackVisibility(track.id);
                    }}
                  >
                    {hiddenTrackIds.includes(track.id) ? "Skjult" : "Synlig"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="flex min-h-[620px] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
            <div className="flex items-center gap-2">
              <Button variant={tool === "select" ? "primary" : "secondary"} icon={<MousePointer2 size={16} />} onClick={() => setTool("select")}>
                Vælg
              </Button>
              <Button variant={tool === "pan" ? "primary" : "secondary"} icon={<Move size={16} />} onClick={() => setTool("pan")}>
                Pan
              </Button>
              <Button
                variant={tool === "calibrate-distance" ? "primary" : "secondary"}
                icon={<MapPinned size={16} />}
                onClick={() => {
                  setCalibrationMethod("distance");
                  setTool("calibrate-distance");
                }}
              >
                Kalibrér
              </Button>
              <Button icon={<ZoomOut size={16} />} onClick={() => setZoom(Math.max(0.4, zoom - 0.2))} aria-label="Zoom ud" title="Zoom ud" />
              <Button icon={<ZoomIn size={16} />} onClick={() => setZoom(Math.min(3, zoom + 0.2))} aria-label="Zoom ind" title="Zoom ind" />
              <Button variant="ghost" onClick={() => setPanOffset({ x: 0, y: 0 })}>
                Nulstil pan
              </Button>
            </div>
            <div className="text-sm text-ink-500">{placementStage || "Klar"}</div>
          </div>

          <svg
            ref={svgRef}
            data-testid="editor-canvas"
            className="min-h-0 flex-1 touch-none bg-[#eef3ec]"
            viewBox={viewBox}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            role="application"
            aria-label="Sporplan editor"
          >
            <defs>
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#cbd8ca" strokeWidth="0.35" />
              </pattern>
              {backgroundImage && backgroundCrop ? (
                <clipPath id={`background-crop-${project.id}`}>
                  <rect x={backgroundCrop.x} y={backgroundCrop.y} width={backgroundCrop.width} height={backgroundCrop.height} />
                </clipPath>
              ) : null}
            </defs>
            {layers.grid ? <rect x="-2000" y="-2000" width="5000" height="5000" fill="url(#grid)" /> : null}
            {layers.background && backgroundImage ? (
              <g
                opacity={backgroundImage.opacity}
                transform={`rotate(${backgroundImage.rotationDegrees} ${backgroundImage.x + backgroundImage.widthMeters / 2} ${
                  backgroundImage.y + backgroundImage.heightMeters / 2
                })`}
                className="pointer-events-none"
              >
                <image
                  href={backgroundImage.url}
                  x={backgroundImage.x}
                  y={backgroundImage.y}
                  width={backgroundImage.widthMeters}
                  height={backgroundImage.heightMeters}
                  preserveAspectRatio="none"
                  clipPath={`url(#background-crop-${project.id})`}
                />
                {backgroundCrop ? (
                  <rect
                    x={backgroundCrop.x}
                    y={backgroundCrop.y}
                    width={backgroundCrop.width}
                    height={backgroundCrop.height}
                    fill="none"
                    stroke="#2f6235"
                    strokeDasharray="2 2"
                    strokeWidth={0.8}
                  />
                ) : null}
              </g>
            ) : null}
            {layers.field ? (
              <>
                <polygon
                  points={project.field.polygon.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="#d9eed9"
                  stroke="#2f6235"
                  strokeWidth={1.6}
                  opacity={0.86}
                />
                <text
                  x={project.field.polygon[0]?.x ?? 0}
                  y={(project.field.polygon[0]?.y ?? 0) - 5}
                  className="fill-ink-700 text-[6px] font-semibold"
                >
                  {project.field.name} · {formatSquareMeters(project.field.areaM2)}
                </text>
              </>
            ) : null}

            {layers.obstacles
              ? project.restrictedAreas.map((area) =>
                  area.type === "polygon" ? (
                    <g key={area.id}>
                      <polygon
                        points={area.polygon.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill={area.color}
                        opacity={0.22}
                        stroke={area.color}
                        strokeWidth={1}
                      />
                      <text x={area.polygon[0].x} y={area.polygon[0].y - 2} className="fill-ink-700 text-[5px]">
                        {area.name}
                      </text>
                    </g>
                  ) : null
                )
              : null}

            {draftPolygon.length > 0 && (
              <polyline
                points={draftPolygon.map((point) => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#f08c00"
                strokeDasharray="3 2"
                strokeWidth={1.4}
              />
            )}

            {draftCalibrationPoints.length > 0 ? (
              <g>
                {draftCalibrationPoints.map((point, index) => (
                  <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={3} fill="#fff" stroke="#0b7285" strokeWidth={1} />
                ))}
                {draftCalibrationPoints.length === 2 ? (
                  <line
                    x1={draftCalibrationPoints[0].x}
                    y1={draftCalibrationPoints[0].y}
                    x2={draftCalibrationPoints[1].x}
                    y2={draftCalibrationPoints[1].y}
                    stroke="#0b7285"
                    strokeDasharray="3 2"
                    strokeWidth={1}
                  />
                ) : null}
              </g>
            ) : null}

            {layers.tracks
              ? visibleTracks.map((track) => (
                  <TrackSvg
                    key={track.id}
                    track={track}
                    selected={selectedTrackIds.includes(track.id)}
                    selectedPointIndex={track.id === selectedTrackId ? selectedPointIndex : undefined}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      const point = snapWorldPoint(toWorld(event));
                      selectTrack(track.id, undefined, event.shiftKey || event.metaKey || event.ctrlKey);
                      setDragging({ type: "track", trackId: track.id, last: point });
                    }}
                    onPointPointerDown={(event, pointIndex) => {
                      event.stopPropagation();
                      selectTrack(track.id, pointIndex, event.shiftKey || event.metaKey || event.ctrlKey);
                      setDragging({ type: "point", trackId: track.id, pointIndex });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const point = toWorld(event);
                      setContextMenu({ x: point.x, y: point.y, trackId: track.id });
                    }}
                  />
                ))
              : null}

            {focusTarget ? <FocusMarker target={focusTarget} viewBoxParts={viewBoxParts} /> : null}

            {validationMessages.map((message, index) =>
              message.position ? (
                <g key={`${message.code}-${index}`}>
                  <rect
                    x={message.position.x + 3}
                    y={message.position.y + 3 + index * 2}
                    width={Math.max(28, message.messageDa.length * 2.1)}
                    height={8}
                    rx={1.5}
                    fill={message.severity === "error" ? "#fff5f5" : "#fff3bf"}
                    stroke={message.severity === "error" ? "#c92a2a" : "#f08c00"}
                    strokeWidth={0.4}
                  />
                  <text
                    x={message.position.x + 5}
                    y={message.position.y + 9 + index * 2}
                    className={message.severity === "error" ? "fill-red-700 text-[4px]" : "fill-amber-800 text-[4px]"}
                  >
                    {message.messageDa}
                  </text>
                </g>
              ) : null
            )}
            {contextMenu ? (
              <g onPointerDown={(event) => event.stopPropagation()}>
                <rect x={contextMenu.x} y={contextMenu.y} width={52} height={36} rx={2} fill="#ffffff" stroke="#cbd5e1" strokeWidth={0.5} />
                <ContextMenuRow x={contextMenu.x} y={contextMenu.y} row={0} label="Vælg" onClick={() => focusContextTrack(contextMenu.trackId)} />
                <ContextMenuRow x={contextMenu.x} y={contextMenu.y} row={1} label="Duplikér" onClick={() => contextDuplicate(contextMenu.trackId)} />
                <ContextMenuRow x={contextMenu.x} y={contextMenu.y} row={2} label="Spejlvend" onClick={() => contextMirror(contextMenu.trackId)} />
                <ContextMenuRow x={contextMenu.x} y={contextMenu.y} row={3} label="Slet" danger onClick={() => contextDelete(contextMenu.trackId)} />
              </g>
            ) : null}
          </svg>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-2 text-xs text-ink-500">
            <span>Zoom {Math.round(zoom * 100)}%</span>
            <span>Målestok: 50 m vises i eksport og SVG</span>
            <span>
              Mus: {mousePosition.x.toFixed(1)}, {mousePosition.y.toFixed(1)} m
            </span>
            <span>Aktivt værktøj: {tool}</span>
          </footer>
        </section>

        <aside className="border-l border-slate-200 bg-white p-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Egenskaber</h2>
              <Badge tone={validation.valid ? "ok" : "error"}>{validation.valid ? "Gyldig" : `${validation.errors.length} fejl`}</Badge>
            </div>
            {selectedTrack ? (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <p className="font-semibold">{selectedTrack.name}</p>
                  <p className="text-sm text-ink-500">
                    {selectedTrack.lengthSteps} skridt · {formatMeters(calculateTrackLength(selectedTrack))}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Segmenter: {calculateSegmentLengths(selectedTrack.points).map((length) => formatMeters(length)).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Knæk: {calculateTurnAngles(selectedTrack.points).map((angle) => `${Math.round(angle)}°`).join(" · ") || "-"}
                  </p>
                  {selectedTrackIds.length > 1 ? (
                    <p className="mt-1 text-xs text-field-700">{selectedTrackIds.length} markerede spor redigeres samlet.</p>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button icon={<RotateCw size={16} />} onClick={() => rotateSelectedTrack(15)}>
                    Rotér
                  </Button>
                  <Button icon={<FlipHorizontal2 size={16} />} onClick={mirrorSelectedTrack}>
                    Spejlvend
                  </Button>
                  <Button icon={<Copy size={16} />} onClick={duplicateSelectedTrack}>
                    Duplikér
                  </Button>
                  <Button onClick={reverseSelectedTrack}>Vend start/slut</Button>
                  <Button onClick={alignSelectedToField}>Ret til mark</Button>
                  <Button icon={<Trash2 size={16} />} variant="danger" onClick={deleteSelectedTrack}>
                    Slet
                  </Button>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <label className="block text-xs font-medium text-ink-700">
                    Finrotation {rotationNudgeDegrees}°
                    <input
                      className="mt-2 w-full accent-field-700"
                      type="range"
                      min={-15}
                      max={15}
                      step={0.5}
                      value={rotationNudgeDegrees}
                      onChange={(event) => setRotationNudgeDegrees(Number(event.currentTarget.value))}
                    />
                  </label>
                  <Button className="mt-3 w-full" onClick={() => rotateSelectedAroundCenter(rotationNudgeDegrees, `Markerede spor roteret ${rotationNudgeDegrees}°`)}>
                    Anvend finrotation
                  </Button>
                </div>
                <div className="rounded-md bg-slate-50 p-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedTrack.lockedAngles}
                      onChange={(event) =>
                        commitProject({
                          ...project,
                          tracks: project.tracks.map((track) =>
                            selectedTrackIds.includes(track.id) ? { ...track, lockedAngles: event.currentTarget.checked } : track
                          )
                        })
                      }
                    />
                    Lås knæk til templatevinkler
                  </label>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedTrack.lockedLength}
                      onChange={(event) =>
                        commitProject({
                          ...project,
                          tracks: project.tracks.map((track) =>
                            selectedTrackIds.includes(track.id) ? { ...track, lockedLength: event.currentTarget.checked } : track
                          )
                        })
                      }
                    />
                    Lås sporlængde
                  </label>
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-ink-500">Genstande</h3>
                  <div className="space-y-2">
                    {selectedTrack.objects.map((object) => (
                      <div key={object.id} className="rounded-md bg-slate-50 p-2 text-sm">
                        <p className="font-medium">Genstand {object.displayNo}</p>
                        <p>{formatMeters(object.distanceAlongTrackMeters)} fra start</p>
                        <p className="text-ink-500">Materiale: {object.material}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-500">Vælg et spor eller et knæk på tegnefladen.</p>
            )}
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Regelstatus</h2>
            {selectedTrack ? (
              <RuleStatusPanel track={selectedTrack} checks={selectedTrackRuleChecks} onFocus={focusRule} />
            ) : (
              <p className="rounded-md bg-slate-50 p-3 text-sm text-ink-500">Vælg et spor for at se regelstatus.</p>
            )}
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Validering</h2>
            <div className="max-h-56 space-y-2 overflow-auto pr-1">
              {validationMessages.length === 0 ? (
                <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Ingen valideringsfejl.</p>
              ) : (
                validationMessages.map((message, index) => (
                  <div
                    key={`${message.code}-${index}`}
                    className={cn(
                      "rounded-md border p-2 text-sm",
                      message.severity === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"
                    )}
                  >
                    {message.messageDa}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Bedste fundne forslag</h2>
            {placementReport ? (
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p>
                  {placementReport.result.placedTrackCount} af {placementReport.result.requestedTrackCount} nye spor placeret
                </p>
                <p>Retning: {formatDegrees(placementReport.directionDegrees)}</p>
                <p>{placementReport.summary}</p>
                {placementReport.triedDirections.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-500">Retninger prøvet: {placementReport.triedDirections.map(formatDegrees).join(", ")}</p>
                ) : null}
                <p className="mt-1 text-xs text-ink-500">Kandidater vurderet: {placementReport.result.candidatesEvaluated}</p>
              </div>
            ) : placement ? (
              <div className="rounded-md bg-slate-50 p-3 text-sm">
                <p>
                  {placement.placedTrackCount} af {placement.requestedTrackCount} spor placeret
                </p>
                <p>Score: {placement.score.toFixed(0)}</p>
                <p>Kandidater vurderet: {placement.candidatesEvaluated}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-500">Kør automatisk placering for at se forslag.</p>
            )}
          </section>

          <section className="mt-6 space-y-3">
            <h2 className="text-sm font-semibold">Eksport</h2>
            <div className="grid grid-cols-2 gap-2">
              <Button icon={<Download size={16} />} onClick={() => void exportPng()}>
                PNG
              </Button>
              <Button icon={<Download size={16} />} onClick={() => downloadProject("svg")}>
                SVG
              </Button>
              <Button icon={<Download size={16} />} onClick={() => downloadProject("geojson")}>
                GeoJSON
              </Button>
              <Button icon={<Save size={16} />} onClick={() => downloadProject("json")}>
                Projekt
              </Button>
            </div>
            <a className="block text-sm text-field-700 underline" href={`/api/projects/${project.id}/export?format=track-sheet`}>
              Hent sporlæggerark som Markdown
            </a>
            <a className="block text-sm text-field-700 underline" href={`/api/projects/${project.id}/export?format=track-sheet-pdf`}>
              Hent sporlæggerark som PDF
            </a>
          </section>
        </aside>
      </main>
    </div>
  );
}

function ContextMenuRow({
  x,
  y,
  row,
  label,
  danger = false,
  onClick
}: {
  x: number;
  y: number;
  row: number;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const rowY = y + row * 9;

  return (
    <g className="cursor-pointer" onClick={onClick}>
      <rect x={x + 1} y={rowY + 1} width={50} height={8} rx={1} fill={danger ? "#fff5f5" : "#ffffff"} />
      <text x={x + 4} y={rowY + 6.5} className={danger ? "fill-red-700 text-[4px]" : "fill-ink-800 text-[4px]"}>
        {label}
      </text>
    </g>
  );
}

function RuleStatusPanel({ track, checks, onFocus }: { track: Track; checks: RuleCheck[]; onFocus: (check: RuleCheck) => void }) {
  const errors = checks.filter((check) => check.status === "error").length;
  const warnings = checks.filter((check) => check.status === "warning").length;

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border p-3 text-sm",
          errors > 0
            ? "border-red-200 bg-red-50 text-red-800"
            : warnings > 0
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
        )}
      >
        <strong>{track.name}</strong>
        <span>{errors > 0 ? `${errors} fejl` : warnings > 0 ? `${warnings} advarsler` : "Alle hovedregler ok"}</span>
      </div>
      <div className="space-y-2">
        {checks.map((check) => (
          <button
            key={check.id}
            className={cn(
              "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
              check.status === "error"
                ? "border-red-200 bg-red-50"
                : check.status === "warning"
                  ? "border-amber-200 bg-amber-50"
                  : "border-slate-200 bg-white"
            )}
            onClick={() => onFocus(check)}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                check.status === "error" ? "bg-red-700" : check.status === "warning" ? "bg-amber-600" : "bg-emerald-700"
              )}
            />
            <span>
              <strong className="block">{check.label}</strong>
              <small className="block text-xs text-ink-500">{check.detail}</small>
            </span>
            <em className="text-right text-xs not-italic text-ink-500">{check.value}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function FocusMarker({ target, viewBoxParts }: { target: NonNullable<FocusTarget>; viewBoxParts: number[] }) {
  const width = viewBoxParts[2] ?? 300;
  const radius = Math.max(6, width / 42);

  return (
    <g pointerEvents="none">
      <circle cx={target.position.x} cy={target.position.y} r={radius} fill="none" stroke="#16201b" strokeWidth={Math.max(1, width / 260)} opacity={0.82} />
      <circle cx={target.position.x} cy={target.position.y} r={radius * 0.55} fill="none" stroke="#ffffff" strokeWidth={Math.max(0.8, width / 420)} opacity={0.9} />
    </g>
  );
}

function TrackSvg({
  track,
  selected,
  selectedPointIndex,
  onPointerDown,
  onPointPointerDown,
  onContextMenu
}: {
  track: Track;
  selected: boolean;
  selectedPointIndex?: number;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
  onPointPointerDown: (event: React.PointerEvent<SVGCircleElement>, pointIndex: number) => void;
  onContextMenu: (event: React.MouseEvent<SVGGElement>) => void;
}) {
  const points = track.points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <g onPointerDown={onPointerDown} onContextMenu={onContextMenu} className="cursor-move">
      <polyline
        points={points}
        fill="none"
        stroke={track.color}
        strokeWidth={selected ? 3.2 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={points}
        fill="none"
        stroke={selected ? "#16201b" : "transparent"}
        strokeWidth={selected ? 4.6 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.2}
      />
      <circle cx={track.points[0].x} cy={track.points[0].y} r={3.4} fill={track.color} />
      <rect
        x={track.points[track.points.length - 1].x - 2.8}
        y={track.points[track.points.length - 1].y - 2.8}
        width={5.6}
        height={5.6}
        fill="#fff"
        stroke={track.color}
        strokeWidth={1}
      />
      <text x={track.points[1].x + 2} y={track.points[1].y - 2} className="pointer-events-none fill-ink-900 text-[5px] font-semibold">
        {track.name}
      </text>
      {track.points.map((point, index) => (
        <circle
          key={`${track.id}-${index}`}
          cx={point.x}
          cy={point.y}
          r={selectedPointIndex === index ? 3.6 : 2.4}
          fill={selectedPointIndex === index ? "#fff" : track.color}
          stroke={selected ? "#16201b" : "#fff"}
          strokeWidth={0.8}
          className="cursor-grab"
          onPointerDown={(event) => onPointPointerDown(event, index)}
        />
      ))}
      {track.objects.map((object) => {
        const position = coordinateAtDistance(track.points, object.distanceAlongTrackMeters);
        return (
          <g key={object.id}>
            <circle cx={position.x} cy={position.y} r={2.6} fill="#fff" stroke={track.color} strokeWidth={1} />
            <text x={position.x + 2.8} y={position.y - 2.8} className="pointer-events-none fill-ink-900 text-[4px]">
              G{object.displayNo}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function calculateViewBox(project: ProjectSnapshot, zoom: number, panOffset: Coordinate): string {
  const points = [
    ...project.field.polygon,
    ...project.tracks.flatMap((track) => track.points),
    ...project.restrictedAreas.flatMap((area) => (area.type === "polygon" ? area.polygon : []))
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs) - 20 + panOffset.x;
  const minY = Math.min(...ys) - 20 + panOffset.y;
  const width = (Math.max(...xs) - Math.min(...xs) + 40) / zoom;
  const height = (Math.max(...ys) - Math.min(...ys) + 40) / zoom;
  return `${minX} ${minY} ${width} ${height}`;
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

function formatDegrees(value: number): string {
  return `${Number(normalizeDegrees(value).toFixed(1))}°`;
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

function scaledSegments(segments: number[], targetLengthMeters: number): number[] {
  const currentLength = segments.reduce((sum, length) => sum + length, 0);
  const scale = targetLengthMeters / currentLength;
  return segments.map((length) => length * scale);
}

function withActiveTemplate(project: ProjectSnapshot, template: TrackTemplateRules): ProjectSnapshot {
  return {
    ...project,
    template,
    templates: replaceTemplate(project.templates ?? dchTrackTemplates, template)
  };
}

function replaceTemplate(templates: TrackTemplateRules[], template: TrackTemplateRules): TrackTemplateRules[] {
  return templates.some((candidate) => candidate.code === template.code)
    ? templates.map((candidate) => (candidate.code === template.code ? template : candidate))
    : [...templates, template];
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

function relabelTracks(tracks: Track[]): Track[] {
  return tracks.map((track, index) => ({ ...track, displayNo: index + 1, name: renameTrack(track, index + 1) }));
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

function panOffsetForPoint(project: ProjectSnapshot, zoom: number, point: Coordinate): Coordinate {
  const bounds = boundsForProject(project);
  const width = (bounds.maxX - bounds.minX + 40) / zoom;
  const height = (bounds.maxY - bounds.minY + 40) / zoom;

  return {
    x: point.x - width / 2 - (bounds.minX - 20),
    y: point.y - height / 2 - (bounds.minY - 20)
  };
}

function boundsForProject(project: ProjectSnapshot): { minX: number; minY: number; maxX: number; maxY: number } {
  const points = [
    ...project.field.polygon,
    ...project.tracks.flatMap((track) => track.points),
    ...project.restrictedAreas.flatMap((area) => (area.type === "polygon" ? area.polygon : []))
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

function createClientTrackId(): string {
  return `track-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function estimateTrackCapacity(project: ProjectSnapshot, template: TrackTemplateRules): number {
  const spacing = Math.max(project.minimumTrackSpacingMeters, template.minTrackSpacingMeters);
  const bounds = polygonBounds(project.field.polygon);
  const sideLength = Math.max(1, (template.lengthMeters - template.minMiddleSegmentMeters) / 2);
  const cellWidth = sideLength + spacing;
  const cellHeight = Math.max(template.minMiddleSegmentMeters, bounds.height * 0.12, 1) + spacing;
  const edgePenaltyArea = project.field.perimeterMeters * project.edgeMarginMeters;
  const usableAreaM2 = Math.max(0, project.field.areaM2 - edgePenaltyArea);
  return normalizeTrackCount(Math.max(1, Math.floor(usableAreaM2 / Math.max(1, cellWidth * cellHeight))));
}

function cropRectForBackground(backgroundImage: FieldBackgroundImage) {
  const left = backgroundImage.widthMeters * (backgroundImage.crop.leftPercent / 100);
  const right = backgroundImage.widthMeters * (backgroundImage.crop.rightPercent / 100);
  const top = backgroundImage.heightMeters * (backgroundImage.crop.topPercent / 100);
  const bottom = backgroundImage.heightMeters * (backgroundImage.crop.bottomPercent / 100);

  return {
    x: backgroundImage.x + left,
    y: backgroundImage.y + top,
    width: Math.max(1, backgroundImage.widthMeters - left - right),
    height: Math.max(1, backgroundImage.heightMeters - top - bottom)
  };
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

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function downloadBlob(content: BlobPart | Blob, fileName: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
