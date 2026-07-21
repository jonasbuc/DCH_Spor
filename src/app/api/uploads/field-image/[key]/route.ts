import { readFile } from "fs/promises";
import path from "path";
import { apiError, apiErrorFromUnknown } from "@/server/api-response";

const mimeTypes = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await context.params;
    const safeKey = path.basename(key);
    if (safeKey !== key) {
      return apiError("NOT_FOUND", "Billedet blev ikke fundet.", 404);
    }

    const contentType = mimeTypes.get(path.extname(safeKey).toLowerCase());
    if (!contentType) {
      return apiError("NOT_FOUND", "Billedet blev ikke fundet.", 404);
    }

    const file = await readFile(path.join(process.cwd(), ".data", "uploads", safeKey));
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600"
      }
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
