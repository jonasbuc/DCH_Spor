"use client";

import { create } from "zustand";
import type { Calibration, Coordinate, FieldBackgroundImage, FieldMapReference, ProjectSnapshot, RestrictedArea, Track } from "@/domain/types";
import { createBTrack } from "@/domain/track/create-track";
import { calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import { reverseTrack } from "@/geometry/polylines";
import { mirrorTrack, rotateTrack, snapTurnToRightAngle, translateTrack } from "@/geometry/transforms";

export type EditorTool = "select" | "pan" | "draw-field" | "add-track" | "add-obstacle" | "calibrate-distance";
export type SaveStatus = "Ikke gemt" | "Gemmer ..." | "Gemt" | "Kunne ikke gemme";

type EditorState = {
  project: ProjectSnapshot;
  selectedTrackId?: string;
  selectedTrackIds: string[];
  selectedPointIndex?: number;
  tool: EditorTool;
  draftPolygon: Coordinate[];
  zoom: number;
  saveStatus: SaveStatus;
  history: ProjectSnapshot[];
  future: ProjectSnapshot[];
  setProject: (project: ProjectSnapshot) => void;
  commitProject: (project: ProjectSnapshot) => void;
  setTool: (tool: EditorTool) => void;
  setSaveStatus: (status: SaveStatus) => void;
  selectTrack: (trackId?: string, pointIndex?: number, additive?: boolean) => void;
  addDraftPoint: (point: Coordinate) => void;
  finishFieldPolygon: () => void;
  addTrackAt: (point: Coordinate) => void;
  replaceTracks: (tracks: Track[]) => void;
  translateSelectedTrack: (dx: number, dy: number) => void;
  rotateSelectedTrack: (angleDegrees: number) => void;
  mirrorSelectedTrack: () => void;
  reverseSelectedTrack: () => void;
  duplicateSelectedTrack: () => void;
  deleteSelectedTrack: () => void;
  moveTrackPoint: (trackId: string, pointIndex: number, point: Coordinate) => void;
  updateFieldArea: (areaM2: number) => void;
  updateFieldBackgroundImage: (patch?: FieldBackgroundImage) => void;
  updateFieldCalibration: (calibration: Calibration, areaM2?: number) => void;
  updateFieldFromMap: (mapReference: FieldMapReference, polygon: Coordinate[]) => void;
  addRestrictedAreaAt: (point: Coordinate) => void;
  updateProjectMeta: (patch: Partial<Pick<ProjectSnapshot, "name" | "club" | "eventName" | "notes">>) => void;
  undo: () => void;
  redo: () => void;
  setZoom: (zoom: number) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  project: emptyProject(),
  selectedTrackIds: [],
  tool: "select",
  draftPolygon: [],
  zoom: 1,
  saveStatus: "Gemt",
  history: [],
  future: [],
  setProject: (project) => set({ project, history: [], future: [], selectedTrackId: undefined, selectedTrackIds: [] }),
  commitProject: (project) => {
    const current = get().project;
    set({
      project: stamp(project),
      history: [...get().history.slice(-40), current],
      future: [],
      saveStatus: "Ikke gemt"
    });
  },
  setTool: (tool) => set({ tool, draftPolygon: tool === "draw-field" ? [] : get().draftPolygon }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  selectTrack: (selectedTrackId, selectedPointIndex, additive = false) => {
    if (!selectedTrackId) {
      set({ selectedTrackId: undefined, selectedTrackIds: [], selectedPointIndex: undefined, tool: "select" });
      return;
    }

    const current = get().selectedTrackIds;
    const selectedTrackIds = additive
      ? current.includes(selectedTrackId)
        ? current.filter((trackId) => trackId !== selectedTrackId)
        : [...current, selectedTrackId]
      : [selectedTrackId];

    set({
      selectedTrackId: selectedTrackIds[selectedTrackIds.length - 1],
      selectedTrackIds,
      selectedPointIndex,
      tool: "select"
    });
  },
  addDraftPoint: (point) => set({ draftPolygon: [...get().draftPolygon, point] }),
  finishFieldPolygon: () => {
    const draft = get().draftPolygon;
    if (draft.length < 3) return;
    const project = get().project;
    const areaM2 = calculatePolygonArea(draft);
    get().commitProject({
      ...project,
      field: {
        ...project.field,
        polygon: draft,
        areaM2,
        areaHa: areaM2 / 10_000,
        perimeterMeters: calculatePolygonPerimeter(draft)
      }
    });
    set({ draftPolygon: [], tool: "select" });
  },
  addTrackAt: (point) => {
    const project = get().project;
    const displayNo = project.tracks.length + 1;
    const track = createBTrack(createClientId("track"), displayNo, point, displayNo % 2 === 0 ? 180 : 0);
    get().commitProject({ ...project, tracks: [...project.tracks, track] });
    set({ selectedTrackId: track.id, selectedTrackIds: [track.id], selectedPointIndex: undefined, tool: "select" });
  },
  replaceTracks: (tracks) => get().commitProject({ ...get().project, tracks }),
  translateSelectedTrack: (dx, dy) => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    if (selected.length === 0) return;
    get().commitProject({
      ...project,
      tracks: project.tracks.map((track) => (selected.includes(track.id) ? translateTrack(track, dx, dy) : track))
    });
  },
  rotateSelectedTrack: (angleDegrees) => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    if (selected.length === 0) return;
    get().commitProject({
      ...project,
      tracks: project.tracks.map((track) => (selected.includes(track.id) ? rotateTrack(track, angleDegrees) : track))
    });
  },
  mirrorSelectedTrack: () => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    if (selected.length === 0) return;
    get().commitProject({
      ...project,
      tracks: project.tracks.map((track) => (selected.includes(track.id) ? mirrorTrack(track, "y") : track))
    });
  },
  reverseSelectedTrack: () => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    if (selected.length === 0) return;
    get().commitProject({
      ...project,
      tracks: project.tracks.map((track) => (selected.includes(track.id) ? reverseTrack(track) : track))
    });
  },
  duplicateSelectedTrack: () => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    const sources = project.tracks.filter((track) => selected.includes(track.id));
    if (sources.length === 0) return;
    const copies = sources.map((source, index) => {
      const displayNo = project.tracks.length + index + 1;
      return translateTrack(
        {
          ...source,
          id: createClientId("track"),
          displayNo,
          name: `Spor ${displayNo}`,
          objects: source.objects.map((object) => ({ ...object, id: createClientId("object") }))
        },
        10,
        10
      );
    });
    get().commitProject({ ...project, tracks: [...project.tracks, ...copies] });
    set({ selectedTrackId: copies[copies.length - 1].id, selectedTrackIds: copies.map((copy) => copy.id) });
  },
  deleteSelectedTrack: () => {
    const { project, selectedTrackId, selectedTrackIds } = get();
    const selected = selectedTrackIds.length > 0 ? selectedTrackIds : selectedTrackId ? [selectedTrackId] : [];
    if (selected.length === 0) return;
    const tracks = project.tracks
      .filter((track) => !selected.includes(track.id))
      .map((track, index) => ({ ...track, displayNo: index + 1, name: `Spor ${index + 1}` }));
    get().commitProject({ ...project, tracks });
    set({ selectedTrackId: undefined, selectedTrackIds: [] });
  },
  moveTrackPoint: (trackId, pointIndex, point) => {
    const project = get().project;
    get().commitProject({
      ...project,
      tracks: project.tracks.map((track) => {
        if (track.id !== trackId) return track;
        const points = track.points.map((candidate, index) => (index === pointIndex ? point : candidate));
        const moved = { ...track, points };
        return track.lockedAngles && pointIndex > 0 && pointIndex < points.length - 1
          ? snapTurnToRightAngle(moved, pointIndex)
          : moved;
      })
    });
  },
  updateFieldArea: (areaM2) => {
    const project = get().project;
    get().commitProject({
      ...project,
      field: {
        ...project.field,
        areaM2,
        areaHa: areaM2 / 10_000,
        calibration: {
          method: "area",
          meterPerPixel: Math.sqrt(areaM2 / Math.max(1, calculatePolygonArea(project.field.polygon))),
          knownAreaM2: areaM2,
          calculatedAreaM2: areaM2,
          deviationPercent: 0,
          warningDa:
            "Arealbaseret kalibrering er kun præcis, hvis billedet har ens målestok i begge retninger og ikke er perspektivforvrænget."
        }
      }
    });
  },
  updateFieldBackgroundImage: (backgroundImage) => {
    const project = get().project;
    get().commitProject({
      ...project,
      field: {
        ...project.field,
        backgroundImage
      }
    });
  },
  updateFieldCalibration: (calibration, areaM2) => {
    const project = get().project;
    const nextAreaM2 = areaM2 ?? project.field.areaM2;
    get().commitProject({
      ...project,
      field: {
        ...project.field,
        areaM2: nextAreaM2,
        areaHa: nextAreaM2 / 10_000,
        calibration
      }
    });
  },
  updateFieldFromMap: (mapReference, polygon) => {
    const project = get().project;
    const areaM2 = calculatePolygonArea(polygon);
    get().commitProject({
      ...project,
      field: {
        ...project.field,
        sourceType: "map",
        mapReference,
        polygon,
        areaM2,
        areaHa: areaM2 / 10_000,
        perimeterMeters: calculatePolygonPerimeter(polygon)
      }
    });
  },
  addRestrictedAreaAt: (point) => {
    const project = get().project;
    const area: RestrictedArea = {
      id: createClientId("restricted"),
      name: `Forbudt område ${project.restrictedAreas.length + 1}`,
      type: "polygon",
      areaType: "område der ikke må betrædes",
      description: "",
      safetyDistanceMeters: 3,
      color: "#d9480f",
      active: true,
      polygon: [
        { x: point.x - 6, y: point.y - 5 },
        { x: point.x + 7, y: point.y - 4 },
        { x: point.x + 6, y: point.y + 6 },
        { x: point.x - 5, y: point.y + 7 }
      ]
    };
    get().commitProject({ ...project, restrictedAreas: [...project.restrictedAreas, area] });
  },
  updateProjectMeta: (patch) => get().commitProject({ ...get().project, ...patch }),
  undo: () => {
    const history = get().history;
    const previous = history[history.length - 1];
    if (!previous) return;
    set({
      project: previous,
      history: history.slice(0, -1),
      future: [get().project, ...get().future],
      selectedTrackIds: get().selectedTrackIds.filter((trackId) => previous.tracks.some((track) => track.id === trackId)),
      saveStatus: "Ikke gemt"
    });
  },
  redo: () => {
    const future = get().future;
    const next = future[0];
    if (!next) return;
    set({
      project: next,
      history: [...get().history, get().project],
      future: future.slice(1),
      selectedTrackIds: get().selectedTrackIds.filter((trackId) => next.tracks.some((track) => track.id === trackId)),
      saveStatus: "Ikke gemt"
    });
  },
  setZoom: (zoom) => set({ zoom })
}));

function stamp(project: ProjectSnapshot): ProjectSnapshot {
  return {
    ...project,
    updatedAt: new Date().toISOString()
  };
}

function createClientId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function emptyProject(): ProjectSnapshot {
  const now = new Date().toISOString();
  return {
    id: "empty",
    name: "Tomt projekt",
    club: "",
    eventName: "",
    description: "",
    notes: "",
    requestedTrackCount: 1,
    edgeMarginMeters: 0,
    minimumTrackSpacingMeters: 15,
    field: {
      id: "empty-field",
      name: "Tom mark",
      sourceType: "image",
      areaM2: 1,
      areaHa: 0.0001,
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
      ],
      perimeterMeters: 4
    },
    restrictedAreas: [],
    template: {
      code: "EMPTY",
      name: "Tom",
      lengthSteps: 1,
      stepLengthMeters: 1,
      lengthMeters: 1,
      turnCount: 0,
      turnAngleDegrees: 90,
      minMiddleSegmentSteps: 1,
      minMiddleSegmentMeters: 1,
      objectCount: 0,
      minTrackSpacingSteps: 1,
      minTrackSpacingMeters: 1,
      trackAgeInfo: "",
      startMarkers: 0,
      objectMaterial: "",
      minLastObjectToFinishMeters: 0,
      minObjectDistanceFromTurnMeters: 0,
      angleToleranceDegrees: 0,
      lengthToleranceMeters: 0
    },
    tracks: [],
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}
