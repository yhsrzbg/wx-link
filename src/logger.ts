import type { LoggerLike } from "./types.js";

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof LEVELS;

function normalizeLevel(level: string | undefined): LogLevel {
  const value = String(level ?? "info").toLowerCase();
  return value in LEVELS ? (value as LogLevel) : "info";
}

export function createLogger(options: { name?: string; level?: string } = {}): LoggerLike {
  const name = options.name ?? "wx-link";
  const minLevel = LEVELS[normalizeLevel(options.level ?? process.env.WX_LINK_LOG_LEVEL)];

  function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= minLevel;
  }

  function write(level: LogLevel, args: unknown[]): void {
    if (!shouldLog(level)) {
      return;
    }
    const prefix = `[${name}]`;
    const writer =
      level === "error" ? console.error :
      level === "warn" ? console.warn :
      console.log;
    writer(prefix, ...args);
  }

  return {
    debug(...args: unknown[]) {
      write("debug", args);
    },
    info(...args: unknown[]) {
      write("info", args);
    },
    warn(...args: unknown[]) {
      write("warn", args);
    },
    error(...args: unknown[]) {
      write("error", args);
    },
  };
}
