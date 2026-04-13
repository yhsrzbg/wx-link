import path from "node:path";

import {
  DEFAULT_BASE_URL,
  DEFAULT_CDN_BASE_URL,
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
} from "./constants.js";
import type {
  ClientOptions,
  DownloadedInboundMedia,
  GetConfigResp,
  GetUpdatesResp,
  MessageItem,
  PollUpdatesResult,
  ResolvedInboundMedia,
  SendMediaByBufferOptions,
  SendMediaByPathOptions,
  SendMediaByUrlOptions,
  SendTextOptions,
  UploadedFileInfo,
} from "./types.js";
import { createApiContext, getConfig, getUpdates, sendMessage, sendTyping } from "./api.js";
import { createLogger } from "./logger.js";
import { downloadInboundMedia, resolveInboundMedia } from "./media.js";
import {
  downloadRemoteMedia,
  uploadFileBufferToWeixin,
  uploadFileToWeixin,
  uploadImageBufferToWeixin,
  uploadImageToWeixin,
  uploadVideoBufferToWeixin,
  uploadVideoToWeixin,
} from "./upload.js";
import {
  generateId,
  getMimeFromFilename,
  isRemoteUrl,
  resolveInputPath,
} from "./utils.js";

function createClientId(): string {
  return generateId("wx-link");
}

function buildTextMessageItem(text: string): MessageItem {
  return {
    type: MessageItemType.TEXT,
    text_item: { text },
  };
}

function buildMediaItem(kind: "image" | "video" | "file", uploaded: UploadedFileInfo, fileName?: string): MessageItem {
  const encodedAesKey = Buffer.from(uploaded.aeskey, "utf8").toString("base64");
  if (kind === "image") {
    return {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: encodedAesKey,
          encrypt_type: 1,
        },
        mid_size: uploaded.fileSizeCiphertext,
      },
    };
  }
  if (kind === "video") {
    return {
      type: MessageItemType.VIDEO,
      video_item: {
        media: {
          encrypt_query_param: uploaded.downloadEncryptedQueryParam,
          aes_key: encodedAesKey,
          encrypt_type: 1,
        },
        video_size: uploaded.fileSizeCiphertext,
      },
    };
  }
  return {
    type: MessageItemType.FILE,
    file_item: {
      media: {
        encrypt_query_param: uploaded.downloadEncryptedQueryParam,
        aes_key: encodedAesKey,
        encrypt_type: 1,
      },
      file_name: fileName,
      len: String(uploaded.fileSize),
      file_size: uploaded.fileSize,
    },
  };
}

export class WxLinkClient {
  readonly ctx;
  readonly cdnBaseUrl: string;

  constructor(options: ClientOptions) {
    if (!options?.token) {
      throw new Error("token is required");
    }
    const logger = options.logger ?? createLogger();
    this.ctx = createApiContext({
      ...options,
      logger,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      cdnBaseUrl: options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    });
    this.cdnBaseUrl = options.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;
  }

  static fromAccount(
    record: Pick<ClientOptions, "token" | "baseUrl" | "cdnBaseUrl">,
    options: Omit<Partial<ClientOptions>, "token" | "baseUrl" | "cdnBaseUrl"> = {},
  ): WxLinkClient {
    return new WxLinkClient({
      ...options,
      token: record.token,
      baseUrl: record.baseUrl ?? DEFAULT_BASE_URL,
      cdnBaseUrl: record.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL,
    });
  }

  async poll(cursor = ""): Promise<PollUpdatesResult> {
    const response = await getUpdates(this.ctx, { get_updates_buf: cursor });
    return {
      ...response,
      nextCursor: response.get_updates_buf ?? cursor,
    };
  }

  async sendText(options: SendTextOptions): Promise<{ messageId: string }> {
    const clientId = createClientId();
    await sendMessage(this.ctx, {
      msg: {
        from_user_id: "",
        to_user_id: options.toUserId,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        context_token: options.contextToken,
        item_list: [buildTextMessageItem(options.text)],
      },
    });
    return { messageId: clientId };
  }

  async sendTextChunked(
    toUserId: string,
    text: string,
    contextToken?: string,
    maxLength = 4000,
  ): Promise<number> {
    if (text.length <= maxLength) {
      await this.sendText({ toUserId, text, contextToken });
      return 1;
    }
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.slice(i, i + maxLength));
    }
    for (const chunk of chunks) {
      await this.sendText({ toUserId, text: chunk, contextToken });
    }
    return chunks.length;
  }

  async sendMedia(
    toUserId: string,
    item: MessageItem,
    contextToken?: string,
    text?: string,
  ): Promise<{ messageId: string }> {
    const items: MessageItem[] = [];
    if (text) {
      items.push(buildTextMessageItem(text));
    }
    items.push(item);

    let lastClientId = "";
    for (const messageItem of items) {
      lastClientId = createClientId();
      await sendMessage(this.ctx, {
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: lastClientId,
          message_type: MessageType.BOT,
          message_state: MessageState.FINISH,
          context_token: contextToken,
          item_list: [messageItem],
        },
      });
    }
    return { messageId: lastClientId };
  }

  async sendImage(options: SendMediaByPathOptions): Promise<{ messageId: string }> {
    const uploaded = await uploadImageToWeixin({
      ctx: this.ctx,
      filePath: resolveInputPath(options.filePath),
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("image", uploaded),
      options.contextToken,
      options.text,
    );
  }

  async sendVideo(options: SendMediaByPathOptions): Promise<{ messageId: string }> {
    const uploaded = await uploadVideoToWeixin({
      ctx: this.ctx,
      filePath: resolveInputPath(options.filePath),
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("video", uploaded),
      options.contextToken,
      options.text,
    );
  }

  async sendFile(options: SendMediaByPathOptions): Promise<{ messageId: string }> {
    const resolvedFilePath = resolveInputPath(options.filePath);
    const uploaded = await uploadFileToWeixin({
      ctx: this.ctx,
      filePath: resolvedFilePath,
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("file", uploaded, path.basename(resolvedFilePath)),
      options.contextToken,
      options.text,
    );
  }

  async sendMediaFromPath(options: SendMediaByPathOptions): Promise<{ messageId: string }> {
    const resolvedFilePath = resolveInputPath(options.filePath);
    const mime = getMimeFromFilename(resolvedFilePath);
    if (mime.startsWith("image/")) {
      return this.sendImage({ ...options, filePath: resolvedFilePath });
    }
    if (mime.startsWith("video/")) {
      return this.sendVideo({ ...options, filePath: resolvedFilePath });
    }
    return this.sendFile({ ...options, filePath: resolvedFilePath });
  }

  async sendMediaFromUrl(options: SendMediaByUrlOptions): Promise<{ messageId: string }> {
    if (!isRemoteUrl(options.url)) {
      throw new Error("url must be http or https");
    }
    const remote = await downloadRemoteMedia({
      url: options.url,
      fetchImpl: this.ctx.fetchImpl,
    });
    return this.sendMediaFromBuffer({
      toUserId: options.toUserId,
      buffer: remote.buffer,
      fileName: remote.fileName,
      contentType: remote.contentType ?? undefined,
      text: options.text,
      contextToken: options.contextToken,
    });
  }

  async sendImageBuffer(options: SendMediaByBufferOptions): Promise<{ messageId: string }> {
    const uploaded = await uploadImageBufferToWeixin({
      ctx: this.ctx,
      buffer: options.buffer,
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("image", uploaded, options.fileName),
      options.contextToken,
      options.text,
    );
  }

  async sendVideoBuffer(options: SendMediaByBufferOptions): Promise<{ messageId: string }> {
    const uploaded = await uploadVideoBufferToWeixin({
      ctx: this.ctx,
      buffer: options.buffer,
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("video", uploaded, options.fileName),
      options.contextToken,
      options.text,
    );
  }

  async sendFileBuffer(options: SendMediaByBufferOptions): Promise<{ messageId: string }> {
    const uploaded = await uploadFileBufferToWeixin({
      ctx: this.ctx,
      buffer: options.buffer,
      toUserId: options.toUserId,
      cdnBaseUrl: this.cdnBaseUrl,
    });
    return this.sendMedia(
      options.toUserId,
      buildMediaItem("file", uploaded, options.fileName),
      options.contextToken,
      options.text,
    );
  }

  async sendMediaFromBuffer(options: SendMediaByBufferOptions): Promise<{ messageId: string }> {
    const mime = options.contentType ?? getMimeFromFilename(options.fileName ?? "");
    if (mime.startsWith("image/")) {
      return this.sendImageBuffer(options);
    }
    if (mime.startsWith("video/")) {
      return this.sendVideoBuffer(options);
    }
    return this.sendFileBuffer(options);
  }

  async getConfig(userId: string, contextToken?: string): Promise<GetConfigResp> {
    return getConfig(this.ctx, userId, contextToken);
  }

  resolveInboundMedia(item: MessageItem): ResolvedInboundMedia | null {
    return resolveInboundMedia(item, {
      cdnBaseUrl: this.cdnBaseUrl,
    });
  }

  downloadInboundMedia(item: MessageItem): Promise<DownloadedInboundMedia | null> {
    return downloadInboundMedia(item, {
      cdnBaseUrl: this.cdnBaseUrl,
      fetchImpl: this.ctx.fetchImpl,
    });
  }

  async sendTyping(userId: string, contextToken?: string): Promise<void> {
    const config = await this.getConfig(userId, contextToken);
    if (config.typing_ticket) {
      await sendTyping(this.ctx, {
        ilink_user_id: userId,
        typing_ticket: config.typing_ticket,
        status: TypingStatus.TYPING,
      });
    }
  }
}
