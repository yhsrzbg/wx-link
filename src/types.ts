import type {
  DEFAULT_APP_ID,
  DEFAULT_BASE_URL,
  DEFAULT_CDN_BASE_URL,
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  UploadMediaType,
} from "./constants.js";

export type FetchLike = typeof fetch;

export interface LoggerLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface BaseInfo {
  channel_version?: string;
  bot_agent?: string;
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  cdnBaseUrl?: string;
  appId?: string;
  channelVersion?: string;
  /**
   * UA-style upstream-app identifier sent as `base_info.bot_agent` on every
   * request, e.g. `"my-app/1.2.3 (prod)"`. Sanitized via `sanitizeBotAgent`;
   * falls back to `"wx-link"` when omitted or invalid.
   */
  botAgent?: string;
  routeTag?: string | number;
  fetchImpl?: FetchLike;
  logger?: LoggerLike;
  longPollTimeoutMs?: number;
  apiTimeoutMs?: number;
  configTimeoutMs?: number;
  tempDir?: string;
}

export interface ApiContext {
  baseUrl: string;
  token?: string;
  fetchImpl: FetchLike;
  logger?: LoggerLike;
  routeTag?: string | number;
  appId: string;
  channelVersion: string;
  botAgent: string;
  clientVersionNumber: number;
  longPollTimeoutMs: number;
  apiTimeoutMs: number;
  configTimeoutMs: number;
}

export interface TextItem {
  text?: string;
}

export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  width?: number;
  height?: number;
  cdn_url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

export interface VoiceItem {
  media?: CDNMedia;
  encode_type?: number;
  bits_per_sample?: number;
  sample_rate?: number;
  playtime?: number;
  text?: string;
  url?: string;
  cdn_url?: string;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
  url?: string;
  cdn_url?: string;
  file_size?: number;
}

export interface VideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  url?: string;
  cdn_url?: string;
  thumb_url?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface RefMessage {
  message_item?: MessageItem;
  title?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  ref_msg?: RefMessage;
  text_item?: TextItem;
  image_item?: ImageItem;
  voice_item?: VoiceItem;
  file_item?: FileItem;
  video_item?: VideoItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesReq {
  get_updates_buf?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  status?: number;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResp {
  ret?: number;
  errmsg?: string;
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status:
    | "wait"
    | "scaned"
    | "confirmed"
    | "expired"
    | "scaned_but_redirect"
    | "need_verifycode"
    | "verify_code_blocked"
    | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface LoginResult {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId?: string;
}

export interface LoginCallbacks {
  onQRCode: (url: string) => void;
  onStatusChange?: (
    status: "waiting" | "scanned" | "expired" | "refreshing" | "need_verifycode" | "verify_code_blocked",
  ) => void;
  /**
   * Called when the server challenges the scan with a pair-code
   * (`need_verifycode`). Return the code the user reads off their phone, or
   * `undefined` to abort. `retry` is true when a previously supplied code was
   * rejected and the server is asking again.
   */
  onVerifyCode?: (info: { retry: boolean }) => Promise<string | undefined> | string | undefined;
}

export interface QrLoginSession {
  sessionKey: string;
  botType: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  currentApiBaseUrl: string;
  refreshCount: number;
  /** Pair-code staged for the next poll after a `need_verifycode` challenge. */
  pendingVerifyCode?: string;
}

export interface CreateQrLoginSessionOptions {
  sessionKey?: string;
  botType?: string;
  fetchImpl?: FetchLike;
  logger?: LoggerLike;
  /**
   * Most-recent local `bot_token`s (up to 10) posted on QR fetch so the server
   * can recognize an already-bound bot and reply with `binded_redirect`
   * instead of issuing a duplicate session.
   */
  localTokenList?: string[];
}

export interface PollQrLoginSessionOptions {
  session: QrLoginSession;
  fetchImpl?: FetchLike;
  logger?: LoggerLike;
  /** Pair-code to send with this poll, answering a prior `need_verifycode`. */
  verifyCode?: string;
}

export interface PollQrLoginSessionResult {
  session: QrLoginSession;
  status: QRStatusResponse["status"];
  done: boolean;
  connected: boolean;
  /**
   * Server reported `binded_redirect`: the scanned bot is already bound to this
   * caller, so no new credentials are issued. Treat as a successful no-op
   * rather than a failure.
   */
  alreadyConnected?: boolean;
  message: string;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
}

export interface PollUpdatesResult extends GetUpdatesResp {
  nextCursor: string;
}

export interface SendMediaByBufferOptions {
  toUserId: string;
  buffer: Buffer<ArrayBufferLike>;
  fileName?: string;
  contentType?: string;
  text?: string;
  contextToken?: string;
}

export interface SendMediaByUrlOptions {
  toUserId: string;
  url: string;
  text?: string;
  contextToken?: string;
}

export interface UploadedFileInfo {
  filekey: string;
  downloadEncryptedQueryParam: string;
  aeskey: string;
  aesKeyBase64: string;
  fileSize: number;
  fileSizeCiphertext: number;
}

export interface ResolvedInboundMedia {
  type: "image" | "voice" | "file" | "video";
  url: string;
  aesKeyBase64?: string;
  contentType?: string;
  fileName?: string;
}

export interface DownloadedInboundMedia extends ResolvedInboundMedia {
  buffer: Buffer<ArrayBufferLike>;
}

export interface SendTextOptions {
  toUserId: string;
  text: string;
  contextToken?: string;
}

export interface SendMediaByPathOptions {
  toUserId: string;
  filePath: string;
  text?: string;
  contextToken?: string;
}

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];
export type MessageItemTypeValue = (typeof MessageItemType)[keyof typeof MessageItemType];
export type MessageStateValue = (typeof MessageState)[keyof typeof MessageState];
export type TypingStatusValue = (typeof TypingStatus)[keyof typeof TypingStatus];
export type UploadMediaTypeValue = (typeof UploadMediaType)[keyof typeof UploadMediaType];
export type DefaultBaseUrl = typeof DEFAULT_BASE_URL;
export type DefaultCdnBaseUrl = typeof DEFAULT_CDN_BASE_URL;
export type DefaultAppId = typeof DEFAULT_APP_ID;
