import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "./preview.css";
import type { Coordinate, FieldBackgroundImage, PlacementOptions, ProjectSnapshot, Track, TrackTemplateRules, TurnDirection, ValidationMessage } from "@/domain/types";
import { createDemoProject } from "@/domain/demo-data";
import { dchTrackTemplates } from "@/domain/rules/templates";
import { createTrackFromShape } from "@/domain/track/create-track";
import { validateProject } from "@/domain/validation/validation";
import { autoPlaceTracks } from "@/geometry/placement/auto-placement";
import { polygonBounds, calculatePolygonArea, calculatePolygonPerimeter } from "@/geometry/polygons";
import { calculateSegmentLengths, calculateTrackLength, coordinateAtDistance } from "@/geometry/polylines";
import { mirrorTrack, rotatePoint, rotateTrack, translateTrack } from "@/geometry/transforms";
import { createMapReference, latLonToLocalMeters } from "@/geometry/map-projection";
import { projectToGeoJson, projectToSvg } from "@/domain/export/exporters";
import { formatHectares, formatMeters, formatSquareMeters, metersToSteps, parseAreaInputToM2 } from "@/utils/locale";

type GeocodeResult = { label: string; lat: number; lon: number };
type SnapshotVersion = { id: string; label: string; snapshot: ProjectSnapshot; createdAt: string };
type ViewBoxState = { x: number; y: number; width: number; height: number };
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
  const [activeTemplateCode, setActiveTemplateCode] = useState("DCH_B");
  const [viewBox, setViewBox] = useState<ViewBoxState>(() => viewBoxForProject(createDemoProject("preview-project")));
  const [showRuleGuides, setShowRuleGuides] = useState(false);
  const [showIssueLabels, setShowIssueLabels] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const requestedTrackCountRef = useRef<HTMLInputElement | null>(null);

  const validation = useMemo(() => validateProject(project), [project]);
  const messages = useMemo(() => [...validation.errors, ...validation.warnings], [validation]);
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackIds[selectedTrackIds.length - 1]) ?? project.tracks[0];
  const activeProfile = resolveTrackProfile(activeTemplateCode, project);
  const suggestedTrackCount = estimateTrackCapacity(project, activeProfile.template);

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

  function runAutoPlacement() {
    const requestedTrackCount = normalizeTrackCount(Number(requestedTrackCountRef.current?.value ?? project.requestedTrackCount));
    const placementProject = withActiveTemplate({ ...project, requestedTrackCount }, activeProfile.template);
    setStage("Automatisk placering beregner kandidater ...");
    window.setTimeout(() => {
      const options: PlacementOptions = {
        requestedTrackCount,
        edgeMarginMeters: project.edgeMarginMeters,
        minimumTrackSpacingMeters: Math.max(project.minimumTrackSpacingMeters, activeProfile.template.minTrackSpacingMeters),
        preferredDirectionDegrees: 0,
        allowMirror: true,
        alternateStartDirections: true,
        placeInRows: true,
        sameShape: false,
        varySegmentLengths: true,
        seed: 42
      };
      const result = autoPlaceTracks(placementProject, options);
      commit({ ...placementProject, tracks: result.tracks }, `${result.placedTrackCount}/${result.requestedTrackCount} spor placeret`);
      setSelectedTrackIds(result.tracks[0] ? [result.tracks[0].id] : []);
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

  function download(format: "svg" | "geojson" | "json") {
    const measuredProject = projectWithMeasuredTracks(project);
    const content =
      format === "svg"
        ? projectToSvg(measuredProject)
        : format === "geojson"
          ? JSON.stringify(projectToGeoJson(measuredProject), null, 2)
          : JSON.stringify(measuredProject, null, 2);
    const type = format === "svg" ? "image/svg+xml" : "application/json";
    downloadBlob(content, `${project.name}.${format}`, type);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
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

    const point = toWorld(event);
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
            <div className="two">
              <button onClick={addTrack}>Tilføj spor</button>
              <button onClick={createCrossingExample}>Lav kryds</button>
              <button onClick={createBoundaryExample}>For tæt på skel</button>
              <button onClick={() => setStage(validation.valid ? "Projektet er gyldigt" : `${validation.errors.length} fejl fundet`)}>
                Validér
              </button>
            </div>
            <div className="scroll stack">
              {project.tracks.map((track) => (
                <button
                  key={track.id}
                  className={`track-row ${selectedTrackIds.includes(track.id) ? "active" : ""}`}
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
              <button onClick={() => zoomCenter(0.82)}>+</button>
              <button onClick={() => zoomCenter(1.22)}>-</button>
              <button onClick={() => setViewBox(viewBoxForPoints(project.field.polygon, 18))}>Fit mark</button>
              <button onClick={() => setViewBox(viewBoxForProject(project))}>Fit alle</button>
              <button className={showRuleGuides ? "primary" : ""} onClick={() => setShowRuleGuides((current) => !current)}>
                Regelguides
              </button>
              <button className={showIssueLabels ? "primary" : ""} onClick={() => setShowIssueLabels((current) => !current)}>
                Fejllabels
              </button>
            </div>
            <span className="pill">{stage}</span>
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
                if (tool === "pan") {
                  setDragging({ type: "pan", lastClientX: event.clientX, lastClientY: event.clientY });
                }
              }}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragging(null)}
              onPointerLeave={() => setDragging(null)}
            >
              {project.field.backgroundImage ? <BackgroundImage image={project.field.backgroundImage} /> : null}
              <polygon points={project.field.polygon.map(pointToSvg).join(" ")} fill="#d9eed9" stroke="#2f6235" strokeWidth={1.6} opacity={0.86} />
              {showRuleGuides ? <RuleGuides project={project} selectedTrackIds={selectedTrackIds} /> : null}
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
                  onPointerDown={(event) => {
                    if (tool === "pan") return;
                    event.stopPropagation();
                    selectTrack(track.id, event.shiftKey || event.metaKey || event.ctrlKey);
                    setDragging({ type: "track", trackId: track.id, last: toWorld(event) });
                  }}
                />
              ))}
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
              <button onClick={() => download("svg")}>SVG</button>
              <button onClick={() => download("geojson")}>GeoJSON</button>
              <button onClick={() => download("json")}>Projekt JSON</button>
              <button onClick={() => download("svg")}>PDF/SVG-ark</button>
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

function TrackSvg({ track, selected, onPointerDown }: { track: Track; selected: boolean; onPointerDown: (event: React.PointerEvent<SVGGElement>) => void }) {
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
        return (
          <g key={object.id}>
            <circle cx={position.x} cy={position.y} r={2.5} fill="#fff" stroke={track.color} strokeWidth={1} />
            <text x={position.x + 2.8} y={position.y - 2.8} fill="#16201b" fontSize="4">
              G{object.displayNo}
            </text>
          </g>
        );
      })}
    </g>
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

function RuleGuides({ project, selectedTrackIds }: { project: ProjectSnapshot; selectedTrackIds: string[] }) {
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
        .filter((track) => selectedTrackIds.includes(track.id))
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
  const [status, setStatus] = useState("Søg adresse og klik polygonpunkter i kortet.");

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
    if (points.length < 3) {
      setStatus("Vælg mindst tre polygonpunkter.");
      return;
    }
    const center = centerOf(points);
    const mapReference = createMapReference({ centerLat: center.lat, centerLon: center.lon, zoom: mapRef.current?.getZoom() ?? 15, address: query });
    const polygon = points.map((point) => latLonToLocalMeters(point, mapReference));
    const areaM2 = calculatePolygonArea(polygon);
    onSave({
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

function downloadBlob(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
