import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { apiError, apiErrorFromUnknown, apiOk } from "@/server/api-response";

const allowedTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"]
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return apiError("UPLOAD_REJECTED", "Upload mangler en billedfil.", 400);
    }

    const extension = allowedTypes.get(file.type);
    if (!extension) {
      return apiError("UPLOAD_REJECTED", "Kun PNG, JPG og WebP er tilladt.", 415);
    }

    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 10_485_760);
    if (file.size > maxBytes) {
      return apiError("UPLOAD_REJECTED", "Billedet er for stort.", 413);
    }

    const uploadDir = path.join(process.cwd(), ".data", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const fileName = `${randomUUID()}.${extension}`;
    const storagePath = path.join(uploadDir, fileName);
    await writeFile(storagePath, Buffer.from(await file.arrayBuffer()));

    return apiOk({
      originalName: file.name,
      mimeType: file.type,
      byteSize: file.size,
      storageKey: fileName
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
