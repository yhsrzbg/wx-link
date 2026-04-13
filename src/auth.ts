import { randomUUID } from "node:crypto";

import { DEFAULT_BASE_URL, DEFAULT_BOT_TYPE } from "./constants.js";
import type {
  CreateQrLoginSessionOptions,
  LoginCallbacks,
  LoginResult,
  PollQrLoginSessionOptions,
  PollQrLoginSessionResult,
  QRCodeResponse,
  QRStatusResponse,
  QrLoginSession,
} from "./types.js";
import { apiGetFetch, createApiContext } from "./api.js";
import { redactToken, sleep } from "./utils.js";

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 480_000;
const MAX_QR_REFRESH_COUNT = 3;

function isLoginFresh(session: QrLoginSession): boolean {
  return Date.now() - session.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function cloneSession(session: QrLoginSession): QrLoginSession {
  return { ...session };
}

export async function fetchQrCode(
  botType: string,
  fetchImpl?: typeof fetch,
  logger?: LoginCallbacks["onStatusChange"] | { info?: (...args: unknown[]) => void },
): Promise<QRCodeResponse> {
  const ctx = createApiContext({
    baseUrl: DEFAULT_BASE_URL,
    fetchImpl,
    logger: typeof logger === "object" ? logger : undefined,
  });
  const raw = await apiGetFetch({
    ctx,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    label: "fetchQRCode",
  });
  return JSON.parse(raw) as QRCodeResponse;
}

export async function pollQrStatus(
  qrcode: string,
  baseUrl: string,
  fetchImpl?: typeof fetch,
  logger?: { warn?: (...args: unknown[]) => void },
): Promise<QRStatusResponse> {
  const ctx = createApiContext({ baseUrl, fetchImpl, logger });
  try {
    const raw = await apiGetFetch({
      ctx,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
    });
    return JSON.parse(raw) as QRStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "wait" };
    }
    logger?.warn?.("pollQRStatus fallback to wait after error", String(error));
    return { status: "wait" };
  }
}

async function refreshQrLoginSession(
  session: QrLoginSession,
  fetchImpl?: typeof fetch,
  logger?: CreateQrLoginSessionOptions["logger"],
): Promise<PollQrLoginSessionResult> {
  const nextRefreshCount = session.refreshCount + 1;
  if (nextRefreshCount > MAX_QR_REFRESH_COUNT) {
    return {
      session: cloneSession(session),
      status: "expired",
      done: true,
      connected: false,
      message: "登录超时：二维码多次过期，请重新开始登录流程。",
    };
  }

  const qrResponse = await fetchQrCode(session.botType, fetchImpl, logger);
  const nextSession: QrLoginSession = {
    ...cloneSession(session),
    qrcode: qrResponse.qrcode,
    qrcodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: DEFAULT_BASE_URL,
    refreshCount: nextRefreshCount,
  };

  logger?.info?.("QR login refreshed", redactToken(qrResponse.qrcode));
  return {
    session: nextSession,
    status: "expired",
    done: false,
    connected: false,
    message: "二维码已刷新，请重新扫码并确认。",
  };
}

export async function createQrLoginSession(
  options: CreateQrLoginSessionOptions = {},
): Promise<QrLoginSession> {
  const botType = options.botType ?? DEFAULT_BOT_TYPE;
  const qrResponse = await fetchQrCode(botType, options.fetchImpl, options.logger);
  const session: QrLoginSession = {
    sessionKey: options.sessionKey ?? randomUUID(),
    botType,
    qrcode: qrResponse.qrcode,
    qrcodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: DEFAULT_BASE_URL,
    refreshCount: 1,
  };
  options.logger?.info?.("QR login started", redactToken(qrResponse.qrcode));
  return session;
}

export async function pollQrLoginSession(
  options: PollQrLoginSessionOptions,
): Promise<PollQrLoginSessionResult> {
  const session = cloneSession(options.session);
  if (!isLoginFresh(session)) {
    return refreshQrLoginSession(session, options.fetchImpl, options.logger);
  }

  const status = await pollQrStatus(
    session.qrcode,
    session.currentApiBaseUrl,
    options.fetchImpl,
    options.logger,
  );

  switch (status.status) {
    case "wait":
      return {
        session,
        status: "wait",
        done: false,
        connected: false,
        message: "等待扫码中",
      };
    case "scaned":
      return {
        session,
        status: "scaned",
        done: false,
        connected: false,
        message: "已扫码，请在微信上确认",
      };
    case "scaned_but_redirect":
      return {
        session: {
          ...session,
          currentApiBaseUrl: status.redirect_host
            ? `https://${status.redirect_host}`
            : session.currentApiBaseUrl,
        },
        status: "scaned_but_redirect",
        done: false,
        connected: false,
        message: "已扫码，正在切换登录节点",
      };
    case "expired":
      return refreshQrLoginSession(session, options.fetchImpl, options.logger);
    case "confirmed":
      return {
        session,
        status: "confirmed",
        done: true,
        connected: true,
        message: "✅ 与微信连接成功！",
        botToken: status.bot_token,
        accountId: status.ilink_bot_id,
        baseUrl: status.baseurl,
        userId: status.ilink_user_id,
      };
  }
}

export async function loginWithQR(
  callbacks: LoginCallbacks,
  options: { baseUrl?: string; botType?: string; fetchImpl?: typeof fetch } = {},
): Promise<LoginResult> {
  const effectiveBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  let session = await createQrLoginSession({
    botType: options.botType,
    fetchImpl: options.fetchImpl,
  });

  callbacks.onQRCode(session.qrcodeUrl);
  callbacks.onStatusChange?.("waiting");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await pollQrLoginSession({
      session,
      fetchImpl: options.fetchImpl,
    });
    session = result.session;

    switch (result.status) {
      case "wait":
        break;
      case "scaned":
      case "scaned_but_redirect":
        callbacks.onStatusChange?.("scanned");
        break;
      case "expired":
        if (result.done) {
          throw new Error(result.message);
        }
        callbacks.onStatusChange?.("expired");
        callbacks.onStatusChange?.("refreshing");
        callbacks.onQRCode(result.session.qrcodeUrl);
        callbacks.onStatusChange?.("waiting");
        break;
      case "confirmed":
        if (!result.botToken || !result.accountId) {
          throw new Error("Login failed: server did not return required credentials");
        }
        return {
          botToken: result.botToken,
          accountId: result.accountId,
          baseUrl: result.baseUrl ?? effectiveBaseUrl,
          userId: result.userId,
        };
    }

    await sleep(1000);
  }

  throw new Error("Login timed out");
}
