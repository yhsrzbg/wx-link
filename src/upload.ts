import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DEFAULT_CDN_BASE_URL, UploadMediaType } from "./constants.js";
import type {
  ApiContext,
  UploadedFileInfo,
  UploadMediaTypeValue,
} from "./types.js";
import { encryptAesEcb, aesEcbPaddedSize } from "./crypto.js";
import { getUploadUrl } from "./api.js";
import {
  ensureDir,
  getExtensionFromContentTypeOrUrl,
} from "./utils.js";

const UPLOAD_MAX_RETRIES = 3;

function buildCdnUploadUrl(params: { cdnBaseUrl: string; uploadParam: string; filekey: string }): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

export async function downloadRemoteMedia(params: {
  url: string;
  fetchImpl?: typeof fetch;
}): Promise<{ buffer: Buffer; contentType: string | null; fileName: string }> {
  const response = await (params.fetchImpl ?? globalThis.fetch)(params.url);
  if (!response.ok) {
    throw new Error(`remote media download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  const ext = getExtensionFromContentTypeOrUrl(response.headers.get("content-type"), params.url);
  const fileName = `wx-link-remote${ext}`;
  return { buffer, contentType, fileName };
}

export async function uploadBufferToCdn(params: {
  buffer: Buffer;
  uploadFullUrl?: string;
  uploadParam?: string;
  filekey: string;
  cdnBaseUrl?: string;
  aesKey: Buffer;
  fetchImpl?: typeof fetch;
}): Promise<{ downloadParam: string }> {
  const ciphertext = encryptAesEcb(params.buffer, params.aesKey);
  const uploadUrl = params.uploadFullUrl?.trim()
    ? params.uploadFullUrl.trim()
    : params.uploadParam
      ? buildCdnUploadUrl({
          cdnBaseUrl: params.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
          uploadParam: params.uploadParam,
          filekey: params.filekey,
        })
      : null;

  if (!uploadUrl) {
    throw new Error("CDN upload URL missing");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt += 1) {
    try {
      const response = await (params.fetchImpl ?? globalThis.fetch)(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
      });
      if (response.status >= 400 && response.status < 500) {
        const message = response.headers.get("x-error-message") ?? await response.text();
        throw new Error(`CDN upload client error ${response.status}: ${message}`);
      }
      if (response.status !== 200) {
        const message = response.headers.get("x-error-message") ?? `status ${response.status}`;
        throw new Error(`CDN upload server error: ${message}`);
      }
      const downloadParam = response.headers.get("x-encrypted-param");
      if (!downloadParam) {
        throw new Error("CDN upload response missing x-encrypted-param header");
      }
      return { downloadParam };
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message.includes("client error")) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("CDN upload failed");
}

async function uploadMediaToWeixin(params: {
  ctx: ApiContext;
  toUserId: string;
  mediaType: UploadMediaTypeValue;
  buffer: Buffer;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  const plaintext = params.buffer;
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aesKey = crypto.randomBytes(16);

  const uploadInfo = await getUploadUrl(params.ctx, {
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aesKey.toString("hex"),
  });

  const uploadResult = await uploadBufferToCdn({
    buffer: plaintext,
    uploadFullUrl: uploadInfo.upload_full_url,
    uploadParam: uploadInfo.upload_param,
    filekey,
    cdnBaseUrl: params.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    aesKey,
    fetchImpl: params.ctx.fetchImpl,
  });

  return {
    filekey,
    downloadEncryptedQueryParam: uploadResult.downloadParam,
    aeskey: aesKey.toString("hex"),
    aesKeyBase64: aesKey.toString("base64"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

async function uploadMediaFileToWeixin(params: {
  ctx: ApiContext;
  filePath: string;
  toUserId: string;
  mediaType: UploadMediaTypeValue;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  const buffer = await fs.readFile(params.filePath);
  return uploadMediaToWeixin({
    ctx: params.ctx,
    toUserId: params.toUserId,
    mediaType: params.mediaType,
    buffer,
    cdnBaseUrl: params.cdnBaseUrl,
  });
}

export function uploadImageToWeixin(params: {
  ctx: ApiContext;
  filePath: string;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaFileToWeixin({
    ...params,
    mediaType: UploadMediaType.IMAGE,
  });
}

export function uploadVideoToWeixin(params: {
  ctx: ApiContext;
  filePath: string;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaFileToWeixin({
    ...params,
    mediaType: UploadMediaType.VIDEO,
  });
}

export function uploadFileToWeixin(params: {
  ctx: ApiContext;
  filePath: string;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaFileToWeixin({
    ...params,
    mediaType: UploadMediaType.FILE,
  });
}

export function uploadImageBufferToWeixin(params: {
  ctx: ApiContext;
  buffer: Buffer;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToWeixin({
    ...params,
    mediaType: UploadMediaType.IMAGE,
  });
}

export function uploadVideoBufferToWeixin(params: {
  ctx: ApiContext;
  buffer: Buffer;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToWeixin({
    ...params,
    mediaType: UploadMediaType.VIDEO,
  });
}

export function uploadFileBufferToWeixin(params: {
  ctx: ApiContext;
  buffer: Buffer;
  toUserId: string;
  cdnBaseUrl?: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToWeixin({
    ...params,
    mediaType: UploadMediaType.FILE,
  });
}
