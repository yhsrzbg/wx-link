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
import { apiGetFetch, apiPostFetch, createApiContext } from "./api.js";
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
  localTokenList?: string[],
): Promise<QRCodeResponse> {
  const ctx = createApiContext({
    baseUrl: DEFAULT_BASE_URL,
    fetchImpl,
    logger: typeof logger === "object" ? logger : undefined,
  });
  // POST with the most-recent local bot tokens (up to 10) so the server can
  // recognize an already-bound bot and reply `binded_redirect` on poll.
  const raw = await apiPostFetch({
    ctx,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: (localTokenList ?? []).slice(0, 10) }),
    label: "fetchQRCode",
  });
  return JSON.parse(raw) as QRCodeResponse;
}

export async function pollQrStatus(
  qrcode: string,
  baseUrl: string,
  fetchImpl?: typeof fetch,
  logger?: { warn?: (...args: unknown[]) => void },
  verifyCode?: string,
): Promise<QRStatusResponse> {
  const ctx = createApiContext({ baseUrl, fetchImpl, logger });
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) {
    endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  }
  try {
    const raw = await apiGetFetch({
      ctx,
      endpoint,
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
  localTokenList?: string[],
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

  const qrResponse = await fetchQrCode(session.botType, fetchImpl, logger, localTokenList);
  const nextSession: QrLoginSession = {
    ...cloneSession(session),
    qrcode: qrResponse.qrcode,
    qrcodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    currentApiBaseUrl: DEFAULT_BASE_URL,
    refreshCount: nextRefreshCount,
    pendingVerifyCode: undefined,
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
  const qrResponse = await fetchQrCode(botType, options.fetchImpl, options.logger, options.localTokenList);
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

  // A caller-supplied verifyCode (answering a prior need_verifycode) takes
  // precedence over any code already staged on the session.
  const verifyCode = options.verifyCode ?? session.pendingVerifyCode;
  if (options.verifyCode) {
    session.pendingVerifyCode = options.verifyCode;
  }

  const status = await pollQrStatus(
    session.qrcode,
    session.currentApiBaseUrl,
    options.fetchImpl,
    options.logger,
    verifyCode,
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
      // Server accepted the scan (and verify code, if any); clear staged code.
      session.pendingVerifyCode = undefined;
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
    case "need_verifycode":
      // Server is challenging the scan with a pair-code. `retry` is implied by
      // whether a code was already staged (i.e. the previous one was rejected).
      return {
        session,
        status: "need_verifycode",
        done: false,
        connected: false,
        message: Boolean(verifyCode)
          ? "配对码不匹配，请重新输入手机微信显示的数字。"
          : "请输入手机微信显示的数字以继续连接。",
      };
    case "verify_code_blocked":
      // Too many wrong codes; drop the staged code and refresh the QR.
      session.pendingVerifyCode = undefined;
      return refreshQrLoginSession(session, options.fetchImpl, options.logger);
    case "binded_redirect":
      // The scanned bot is already bound to this caller — successful no-op.
      return {
        session,
        status: "binded_redirect",
        done: true,
        connected: false,
        alreadyConnected: true,
        message: "已连接过此应用，无需重复连接。",
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
  options: { baseUrl?: string; botType?: string; fetchImpl?: typeof fetch; localTokenList?: string[] } = {},
): Promise<LoginResult> {
  const effectiveBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  let session = await createQrLoginSession({
    botType: options.botType,
    fetchImpl: options.fetchImpl,
    localTokenList: options.localTokenList,
  });

  callbacks.onQRCode(session.qrcodeUrl);
  callbacks.onStatusChange?.("waiting");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let nextVerifyCode: string | undefined;

  while (Date.now() < deadline) {
    const result = await pollQrLoginSession({
      session,
      fetchImpl: options.fetchImpl,
      verifyCode: nextVerifyCode,
    });
    session = result.session;
    nextVerifyCode = undefined;

    switch (result.status) {
      case "wait":
        break;
      case "scaned":
      case "scaned_but_redirect":
        callbacks.onStatusChange?.("scanned");
        break;
      case "need_verifycode": {
        callbacks.onStatusChange?.("need_verifycode");
        const code = await callbacks.onVerifyCode?.({ retry: Boolean(session.pendingVerifyCode) });
        if (!code) {
          throw new Error("登录失败：需要配对码但未提供。");
        }
        nextVerifyCode = code;
        // Re-poll immediately with the supplied code (skip the 1s sleep).
        continue;
      }
      case "verify_code_blocked":
        callbacks.onStatusChange?.("verify_code_blocked");
        callbacks.onStatusChange?.("refreshing");
        callbacks.onQRCode(result.session.qrcodeUrl);
        callbacks.onStatusChange?.("waiting");
        break;
      case "binded_redirect":
        throw new Error(result.message);
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
