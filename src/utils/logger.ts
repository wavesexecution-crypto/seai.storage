import pino from 'pino';
import { getConfig } from '../config/env.js';

let logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (logger) return logger;
  const cfg = safeConfig();
  logger = pino(
    cfg.NODE_ENV === 'development' || cfg.NODE_ENV === 'test'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: false, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
          level: cfg.LOG_LEVEL,
        }
      : { level: cfg.LOG_LEVEL },
  );
  return logger;
}

function safeConfig(): { NODE_ENV: string; LOG_LEVEL: string } {
  try {
    const c = getConfig();
    return { NODE_ENV: c.NODE_ENV, LOG_LEVEL: c.LOG_LEVEL };
  } catch {
    return { NODE_ENV: process.env.NODE_ENV ?? 'development', LOG_LEVEL: process.env.LOG_LEVEL ?? 'info' };
  }
}

/** Test-only reset. */
export function __resetLoggerForTests(): void {
  logger = null;
}
