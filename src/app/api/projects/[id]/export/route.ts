import { projectToGeoJson, projectToSvg, trackSheetMarkdown } from "@/domain/export/exporters";
import type { Coordinate, ProjectSnapshot, Track } from "@/domain/types";
import { validateProject } from "@/domain/validation/validation";
import { calculateSegmentLengths, coordinateAtDistance } from "@/geometry/polylines";
import { apiError, apiErrorFromUnknown } from "@/server/api-response";
import { getProject } from "@/server/project-repository";

export const dynamic = "force-dynamic";

type PdfDocument = {
  setFont: (fontName: string, fontStyle?: string) => PdfDocument;
  setFontSize: (size: number) => PdfDocument;
  setDrawColor: (color: string) => PdfDocument;
  setLineWidth: (width: number) => PdfDocument;
  setTextColor: (color: string) => PdfDocument;
  text: (text: string, x: number, y: number) => PdfDocument;
  line: (x1: number, y1: number, x2: number, y2: number) => PdfDocument;
  circle: (x: number, y: number, radius: number, style?: string) => PdfDocument;
  rect: (x: number, y: number, width: number, height: number, style?: string) => PdfDocument;
  addPage: () => PdfDocument;
};

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);

    if (!project) {
      return apiError("NOT_FOUND", "Projektet blev ikke fundet.", 404);
    }

    const format = new URL(request.url).searchParams.get("format") ?? "project-json";

    if (format === "svg") {
      return new Response(projectToSvg(project), {
        headers: {
          "Content-Type": "image/svg+xml; charset=utf-8",
          "Content-Disposition": filename(project.name, "svg")
        }
      });
    }

    if (format === "geojson") {
      return jsonDownload(projectToGeoJson(project), project.name, "geojson");
    }

    if (format === "track-sheet") {
      const sheet = project.tracks.map((track) => trackSheetMarkdown(project, track)).join("\n\n---\n\n");
      return new Response(sheet, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": filename(project.name, "md")
        }
      });
    }

    if (format === "track-sheet-pdf") {
      const pdf = await createTrackSheetPdf(project);
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": filename(`${project.name}-sporlæggerark`, "pdf")
        }
      });
    }

    if (format === "pdf") {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const validation = validateProject(project);
      doc.setFont("helvetica", "bold");
      doc.text(project.name, 14, 16);
      doc.setFont("helvetica", "normal");
      doc.text(`Klub: ${project.club || "-"}  |  Spor: ${project.tracks.length}  |  Status: ${validation.valid ? "Gyldig" : "Fejl"}`, 14, 26);
      doc.text("Oversigtsplan med markpolygon, forbudte områder, sporstart, afslutning og genstande.", 14, 36);
      drawProjectOverview(doc, project, { x: 14, y: 44, width: 210, height: 140 });
      drawTrackLegend(doc, project, { x: 232, y: 46 });
      const output = doc.output("arraybuffer");
      return new Response(Buffer.from(output), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": filename(project.name, "pdf")
        }
      });
    }

    return jsonDownload(project, project.name, "json");
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

function jsonDownload(value: unknown, name: string, extension: string): Response {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": filename(name, extension)
    }
  });
}

async function createTrackSheetPdf(project: ProjectSnapshot): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  project.tracks.forEach((track, index) => {
    if (index > 0) doc.addPage();
    drawTrackSheetPage(doc, project, track);
  });

  return doc.output("arraybuffer");
}

function drawTrackSheetPage(doc: PdfDocument, project: ProjectSnapshot, track: Track) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Sporlæggerark - ${track.name}`, 16, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Projekt: ${project.name}`, 16, 29);
  doc.text(`Klub: ${project.club || "-"}`, 16, 36);
  doc.text(`Arrangement: ${project.eventName || "-"}`, 16, 43);
  doc.text(`Samlet længde: ${track.lengthSteps} skridt / ${track.lengthMeters.toFixed(1)} m`, 16, 50);
  doc.text(`Regeltemplate: ${project.template.name}`, 16, 57);

  drawTrackDiagram(doc, track, { x: 16, y: 66, width: 178, height: 84 });

  const segmentLengths = calculateSegmentLengths(track.points);
  doc.setFont("helvetica", "bold");
  doc.text("Segmenter", 16, 162);
  doc.setFont("helvetica", "normal");
  segmentLengths.forEach((length, index) => {
    doc.text(`${index + 1}. ${length.toFixed(1)} m`, 16, 171 + index * 7);
  });

  doc.setFont("helvetica", "bold");
  doc.text("Genstande", 78, 162);
  doc.setFont("helvetica", "normal");
  track.objects.forEach((object, index) => {
    doc.text(
      `G${object.displayNo}: ${object.distanceAlongTrackMeters.toFixed(1)} m fra start, ${object.material}`,
      78,
      171 + index * 7
    );
  });

  doc.setFont("helvetica", "bold");
  doc.text("Kontrol", 16, 210);
  doc.setFont("helvetica", "normal");
  doc.text("Tidspunkt for sporlægning: ________________________________", 16, 221);
  doc.text("Sporlæggerens navn: ____________________________________", 16, 233);
  doc.text("Dommer/kontrol: _________________________________________", 16, 245);
  doc.text("Noter:", 16, 260);
  doc.line(16, 268, 194, 268);
  doc.line(16, 280, 194, 280);
}

function drawProjectOverview(
  doc: PdfDocument,
  project: ProjectSnapshot,
  frame: { x: number; y: number; width: number; height: number }
) {
  const transform = createPdfTransform(project, frame);
  doc.setDrawColor("#2f6235");
  doc.setLineWidth(0.55);
  drawClosedPolyline(doc, project.field.polygon.map(transform));

  project.restrictedAreas
    .filter((area) => area.active)
    .forEach((area) => {
      if (area.type !== "polygon") return;
      doc.setDrawColor(area.color);
      doc.setLineWidth(0.45);
      drawClosedPolyline(doc, area.polygon.map(transform));
    });

  project.tracks.forEach((track) => {
    doc.setDrawColor(track.color);
    doc.setLineWidth(0.9);
    drawOpenPolyline(doc, track.points.map(transform));
    const start = transform(track.points[0]);
    const finish = transform(track.points[track.points.length - 1]);
    doc.circle(start.x, start.y, 1.8, "S");
    doc.rect(finish.x - 1.4, finish.y - 1.4, 2.8, 2.8);
    track.objects.forEach((object) => {
      const position = transform(coordinateAtDistance(track.points, object.distanceAlongTrackMeters));
      doc.circle(position.x, position.y, 1.3, "S");
      doc.text(`G${object.displayNo}`, position.x + 2, position.y - 1);
    });
  });
}

function drawTrackLegend(doc: PdfDocument, project: ProjectSnapshot, origin: Coordinate) {
  doc.setFontSize(9);
  project.tracks.slice(0, 15).forEach((track, index) => {
    const y = origin.y + index * 7;
    doc.setDrawColor(track.color);
    doc.setLineWidth(1.1);
    doc.line(origin.x, y, origin.x + 10, y);
    doc.setTextColor("#16201b");
    doc.text(`${track.name}: ${track.lengthSteps} skridt / ${track.lengthMeters.toFixed(1)} m`, origin.x + 14, y + 1.6);
  });
}

function drawTrackDiagram(
  doc: PdfDocument,
  track: Track,
  frame: { x: number; y: number; width: number; height: number }
) {
  const transform = createPointTransform(track.points, frame);
  doc.setDrawColor(track.color);
  doc.setLineWidth(1.1);
  drawOpenPolyline(doc, track.points.map(transform));
  const start = transform(track.points[0]);
  const finish = transform(track.points[track.points.length - 1]);
  doc.circle(start.x, start.y, 2.2, "S");
  doc.rect(finish.x - 1.8, finish.y - 1.8, 3.6, 3.6);
  doc.text("Start", start.x + 3, start.y - 2);
  doc.text("Slut", finish.x + 3, finish.y - 2);
}

function createPdfTransform(project: ProjectSnapshot, frame: { x: number; y: number; width: number; height: number }) {
  const points = [
    ...project.field.polygon,
    ...project.tracks.flatMap((track) => track.points),
    ...project.restrictedAreas.flatMap((area) => (area.type === "polygon" ? area.polygon : []))
  ];
  return createPointTransform(points, frame);
}

function createPointTransform(points: Coordinate[], frame: { x: number; y: number; width: number; height: number }) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(1, Math.max(...xs) - minX);
  const height = Math.max(1, Math.max(...ys) - minY);
  const scale = Math.min(frame.width / width, frame.height / height);
  const xPad = (frame.width - width * scale) / 2;
  const yPad = (frame.height - height * scale) / 2;

  return (point: Coordinate): Coordinate => ({
    x: frame.x + xPad + (point.x - minX) * scale,
    y: frame.y + yPad + (point.y - minY) * scale
  });
}

function drawOpenPolyline(doc: PdfDocument, points: Coordinate[]) {
  points.slice(1).forEach((point, index) => {
    const previous = points[index];
    doc.line(previous.x, previous.y, point.x, point.y);
  });
}

function drawClosedPolyline(doc: PdfDocument, points: Coordinate[]) {
  drawOpenPolyline(doc, [...points, points[0]]);
}

function filename(name: string, extension: string): string {
  const safe = name
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, "-")
    .replace(/^-|-$/g, "");
  return `attachment; filename="${safe || "sporplan"}.${extension}"`;
}
