import { createDecipheriv } from "node:crypto";

import { DEFAULT_CDN_BASE_URL, MessageItemType } from "./constants.js";
import type {
  DownloadedInboundMedia,
  MessageItem,
  ResolvedInboundMedia,
} from "./types.js";

export function buildCdnDownloadUrl(
  encryptedQueryParam: string,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
): string {
  return `${cdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`;
}

export function parseInboundAesKey(aesKeyBase64: string): Buffer {
  const decoded = Buffer.from(aesKeyBase64, "base64");
  if (decoded.length === 16) {
    return decoded;
  }
  const ascii = decoded.toString("ascii");
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(ascii)) {
    return Buffer.from(ascii, "hex");
  }
  throw new Error(`invalid aes_key payload length=${decoded.length}`);
}

export function decryptInboundMedia(ciphertext: Buffer, aesKeyBase64: string): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", parseInboundAesKey(aesKeyBase64), null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function detectMediaContentType(
  buffer: Buffer,
  fallbackType = "application/octet-stream",
): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 6 &&
    (buffer.slice(0, 6).toString("ascii") === "GIF87a" ||
      buffer.slice(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString("ascii") === "RIFF" &&
    buffer.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(4, 8).toString("ascii") === "ftyp"
  ) {
    return "video/mp4";
  }
  if (buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }
  if (buffer.length >= 3 && buffer.slice(0, 3).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  return fallbackType;
}

function resolveUrl(
  directUrl?: string,
  cdnUrl?: string,
  fullUrl?: string,
  encryptQueryParam?: string,
  cdnBaseUrl = DEFAULT_CDN_BASE_URL,
): string {
  if (directUrl) {
    return directUrl;
  }
  if (cdnUrl) {
    return cdnUrl;
  }
  if (fullUrl) {
    return fullUrl;
  }
  if (encryptQueryParam) {
    return buildCdnDownloadUrl(encryptQueryParam, cdnBaseUrl);
  }
  return "";
}

export function resolveInboundMedia(
  item: MessageItem,
  options: { cdnBaseUrl?: string } = {},
): ResolvedInboundMedia | null {
  const cdnBaseUrl = options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;

  if (item.type === MessageItemType.IMAGE) {
    const image = item.image_item;
    const url = resolveUrl(
      image?.url,
      image?.cdn_url,
      image?.media?.full_url,
      image?.media?.encrypt_query_param,
      cdnBaseUrl,
    );
    if (!url) {
      return null;
    }
    return {
      type: "image",
      url,
      aesKeyBase64: image?.aeskey
        ? Buffer.from(image.aeskey, "hex").toString("base64")
        : image?.media?.aes_key,
      contentType: "image/jpeg",
      fileName: "image",
    };
  }

  if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    const url = resolveUrl(
      voice?.url,
      voice?.cdn_url,
      voice?.media?.full_url,
      voice?.media?.encrypt_query_param,
      cdnBaseUrl,
    );
    if (!url) {
      return null;
    }
    return {
      type: "voice",
      url,
      aesKeyBase64: voice?.media?.aes_key,
      contentType: "audio/mpeg",
      fileName: "voice",
    };
  }

  if (item.type === MessageItemType.FILE) {
    const file = item.file_item;
    const url = resolveUrl(
      file?.url,
      file?.cdn_url,
      file?.media?.full_url,
      file?.media?.encrypt_query_param,
      cdnBaseUrl,
    );
    if (!url) {
      return null;
    }
    return {
      type: "file",
      url,
      aesKeyBase64: file?.media?.aes_key,
      contentType: "application/octet-stream",
      fileName: file?.file_name || "file",
    };
  }

  if (item.type === MessageItemType.VIDEO) {
    const video = item.video_item;
    const url = resolveUrl(
      video?.url,
      video?.cdn_url,
      video?.media?.full_url,
      video?.media?.encrypt_query_param,
      cdnBaseUrl,
    );
    if (!url) {
      return null;
    }
    return {
      type: "video",
      url,
      aesKeyBase64: video?.media?.aes_key,
      contentType: "video/mp4",
      fileName: "video",
    };
  }

  return null;
}

export async function downloadResolvedInboundMedia(
  media: ResolvedInboundMedia,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<DownloadedInboundMedia> {
  const response = await (options.fetchImpl ?? globalThis.fetch)(media.url);
  if (!response.ok) {
    throw new Error(`media download failed: ${response.status} ${response.statusText}`);
  }

  const upstreamType = response.headers.get("content-type") || media.contentType;
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(await response.arrayBuffer());
  if (media.aesKeyBase64) {
    buffer = decryptInboundMedia(buffer, media.aesKeyBase64);
  }

  return {
    ...media,
    buffer,
    contentType: detectMediaContentType(buffer, upstreamType),
  };
}

export async function downloadInboundMedia(
  item: MessageItem,
  options: { cdnBaseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<DownloadedInboundMedia | null> {
  const resolved = resolveInboundMedia(item, { cdnBaseUrl: options.cdnBaseUrl });
  if (!resolved) {
    return null;
  }
  return downloadResolvedInboundMedia(resolved, { fetchImpl: options.fetchImpl });
}
