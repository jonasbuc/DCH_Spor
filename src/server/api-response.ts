import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ApiErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_FIELD_POLYGON"
  | "RATE_LIMITED"
  | "UPLOAD_REJECTED"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

export function apiError(code: ApiErrorCode, message: string, status = 400): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message
      }
    },
    { status }
  );
}

export function apiErrorFromUnknown(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return apiError("INVALID_INPUT", "Inputtet er ugyldigt.", 422);
  }

  if (error instanceof Error) {
    return apiError("INTERNAL_ERROR", error.message, 500);
  }

  return apiError("INTERNAL_ERROR", "Der opstod en ukendt fejl.", 500);
}
