import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateId(prefix: string): string {
  return `${prefix}:${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

export function tempFileName(prefix: string, ext: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
}

export function normalizeAccountId(raw: string): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) {
    throw new Error("accountId is required");
  }
  const normalized = value
    .replace(/@/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) {
    throw new Error(`invalid accountId: ${raw}`);
  }
  return normalized;
}

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

export function getMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
}

export function getExtensionFromMime(mimeType: string): string {
  const ct = (String(mimeType ?? "").split(";")[0] ?? "").trim().toLowerCase();
  return MIME_TO_EXTENSION[ct] ?? ".bin";
}

export function getExtensionFromContentTypeOrUrl(contentType: string | null, url: string): string {
  if (contentType) {
    const ext = getExtensionFromMime(contentType);
    if (ext !== ".bin") {
      return ext;
    }
  }
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return EXTENSION_TO_MIME[ext] !== undefined ? ext : ".bin";
}

export function buildClientVersion(version: string): number {
  const parts = String(version ?? "0.0.0").split(".").map((item) => Number.parseInt(item, 10) || 0);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), "utf8").toString("base64");
}

export function isRemoteUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

export function isFileUrl(value: string): boolean {
  return value.startsWith("file://");
}

export function resolveInputPath(fileOrUrl: string): string {
  if (isFileUrl(fileOrUrl)) {
    return fileURLToPath(fileOrUrl);
  }
  if (path.isAbsolute(fileOrUrl)) {
    return fileOrUrl;
  }
  return path.resolve(fileOrUrl);
}

export function redactToken(token: string | undefined): string {
  if (!token) {
    return "(none)";
  }
  if (token.length <= 6) {
    return `****(len=${token.length})`;
  }
  return `${token.slice(0, 6)}...(len=${token.length})`;
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}${url.search ? "?<redacted>" : ""}`;
  } catch {
    return String(rawUrl);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error !== null && typeof error === "object" && "code" in error;
}
