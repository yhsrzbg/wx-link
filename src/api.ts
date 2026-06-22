import {
  DEFAULT_APP_ID,
  DEFAULT_CHANNEL_VERSION,
} from "./constants.js";
import type {
  ApiContext,
  BaseInfo,
  ClientOptions,
  GetConfigResp,
  GetUpdatesResp,
  GetUploadUrlResp,
  SendMessageReq,
} from "./types.js";
import {
  buildClientVersion,
  randomWechatUin,
  redactToken,
  redactUrl,
  sanitizeBotAgent,
} from "./utils.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildBaseInfo(ctx: ApiContext): BaseInfo {
  return { channel_version: ctx.channelVersion, bot_agent: ctx.botAgent };
}

function buildCommonHeaders(ctx: ApiContext): Record<string, string> {
  const headers: Record<string, string> = {
    "iLink-App-Id": ctx.appId,
    "iLink-App-ClientVersion": String(ctx.clientVersionNumber),
  };
  if (ctx.routeTag !== undefined) {
    headers.SKRouteTag = String(ctx.routeTag);
  }
  return headers;
}

function buildHeaders(ctx: ApiContext): Record<string, string> {
  // NOTE: do NOT set Content-Length manually. The undici fetch bundled with
  // Node 24 rejects a pre-set Content-Length with
  // `UND_ERR_INVALID_ARG: invalid content-length header`, which breaks every
  // API call. Let fetch derive it from the request body.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders(ctx),
  };
  if (ctx.token) {
    headers.Authorization = `Bearer ${ctx.token}`;
  }
  return headers;
}

export function createApiContext(options: ClientOptions | (Partial<ClientOptions> & { baseUrl: string })): ApiContext {
  return {
    baseUrl: options.baseUrl,
    token: options.token?.trim() || undefined,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    logger: options.logger,
    routeTag: options.routeTag,
    appId: options.appId ?? DEFAULT_APP_ID,
    channelVersion: options.channelVersion ?? DEFAULT_CHANNEL_VERSION,
    botAgent: sanitizeBotAgent(options.botAgent),
    clientVersionNumber: buildClientVersion(options.channelVersion ?? DEFAULT_CHANNEL_VERSION),
    longPollTimeoutMs: options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    apiTimeoutMs: options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    configTimeoutMs: options.configTimeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
  };
}

function toApiContext(ctxOrOptions: ApiContext | ClientOptions): ApiContext {
  return "clientVersionNumber" in ctxOrOptions
    ? ctxOrOptions
    : createApiContext(ctxOrOptions);
}

export async function apiGetFetch(params: {
  ctx: ApiContext;
  endpoint: string;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.ctx.baseUrl));
  params.ctx.logger?.debug?.(`${params.label}: GET ${redactUrl(url.toString())}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? params.ctx.longPollTimeoutMs);
  try {
    const response = await params.ctx.fetchImpl(url.toString(), {
      method: "GET",
      headers: buildCommonHeaders(params.ctx),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`${params.label} ${response.status}: ${body}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function apiPostFetch(params: {
  ctx: ApiContext;
  endpoint: string;
  body: string;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.ctx.baseUrl));
  params.ctx.logger?.debug?.(
    `${params.label}: POST ${redactUrl(url.toString())} token=${redactToken(params.ctx.token)}`
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? params.ctx.apiTimeoutMs);
  try {
    const response = await params.ctx.fetchImpl(url.toString(), {
      method: "POST",
      headers: buildHeaders(params.ctx),
      body: params.body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${params.label} ${response.status}: ${raw}`);
    }
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

export async function getUpdates(
  ctxOrOptions: ApiContext | ClientOptions,
  params: { get_updates_buf?: string } = {},
): Promise<GetUpdatesResp> {
  const ctx = toApiContext(ctxOrOptions);
  try {
    const raw = await apiPostFetch({
      ctx,
      endpoint: "ilink/bot/getupdates",
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? "",
        base_info: buildBaseInfo(ctx),
      }),
      timeoutMs: ctx.longPollTimeoutMs,
      label: "getUpdates",
    });
    return JSON.parse(raw) as GetUpdatesResp;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw error;
  }
}

export async function sendMessage(
  ctxOrOptions: ApiContext | ClientOptions,
  body: SendMessageReq,
): Promise<void> {
  const ctx = toApiContext(ctxOrOptions);
  await apiPostFetch({
    ctx,
    endpoint: "ilink/bot/sendmessage",
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(ctx),
    }),
    timeoutMs: ctx.apiTimeoutMs,
    label: "sendMessage",
  });
}

export async function getConfig(
  ctxOrOptions: ApiContext | ClientOptions,
  ilinkUserId: string,
  contextToken?: string,
): Promise<GetConfigResp> {
  const ctx = toApiContext(ctxOrOptions);
  const raw = await apiPostFetch({
    ctx,
    endpoint: "ilink/bot/getconfig",
    body: JSON.stringify({
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: buildBaseInfo(ctx),
    }),
    timeoutMs: ctx.configTimeoutMs,
    label: "getConfig",
  });
  return JSON.parse(raw) as GetConfigResp;
}

export async function sendTyping(
  ctxOrOptions: ApiContext | ClientOptions,
  body: { ilink_user_id?: string; typing_ticket?: string; status?: number },
): Promise<void> {
  const ctx = toApiContext(ctxOrOptions);
  await apiPostFetch({
    ctx,
    endpoint: "ilink/bot/sendtyping",
    body: JSON.stringify({
      ...body,
      base_info: buildBaseInfo(ctx),
    }),
    timeoutMs: ctx.configTimeoutMs,
    label: "sendTyping",
  });
}

export async function getUploadUrl(
  ctxOrOptions: ApiContext | ClientOptions,
  params: {
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
  },
): Promise<GetUploadUrlResp> {
  const ctx = toApiContext(ctxOrOptions);
  const raw = await apiPostFetch({
    ctx,
    endpoint: "ilink/bot/getuploadurl",
    body: JSON.stringify({
      ...params,
      base_info: buildBaseInfo(ctx),
    }),
    timeoutMs: ctx.apiTimeoutMs,
    label: "getUploadUrl",
  });
  return JSON.parse(raw) as GetUploadUrlResp;
}
