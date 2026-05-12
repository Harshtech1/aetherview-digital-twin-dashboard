import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

const ALLOWED_FOLDERS = new Set(["raw_uploads", "optimized_sogs"]);

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function resolveFolder(folder: unknown): string {
  if (typeof folder !== "string" || !ALLOWED_FOLDERS.has(folder)) {
    return "raw_uploads";
  }

  return folder;
}

function signUploadParams(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.entries(params)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

export async function POST(request: Request): Promise<Response> {
  try {
    const requestBody =
      request.headers.get("content-type")?.includes("application/json")
        ? ((await request.json()) as { folder?: string } | null)
        : null;
    const folder = resolveFolder(requestBody?.folder);
    const cloudName = getRequiredEnv("CLOUDINARY_CLOUD_NAME");
    const unsignedUploadPreset = process.env.CLOUDINARY_UNSIGNED_UPLOAD_PRESET;

    if (unsignedUploadPreset) {
      return NextResponse.json({
        mode: "unsigned",
        cloudName,
        folder,
        resourceType: "raw",
        uploadPreset: unsignedUploadPreset,
      });
    }

    const apiKey = getRequiredEnv("CLOUDINARY_API_KEY");
    const apiSecret = getRequiredEnv("CLOUDINARY_API_SECRET");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signingParams = {
      folder,
      timestamp,
    };

    return NextResponse.json({
      mode: "signed",
      apiKey,
      cloudName,
      folder,
      resourceType: "raw",
      signature: signUploadParams(signingParams, apiSecret),
      timestamp,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to prepare Cloudinary upload parameters.",
      },
      { status: 500 },
    );
  }
}
