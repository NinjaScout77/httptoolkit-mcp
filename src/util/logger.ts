type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const env = process.env['LOG_LEVEL']?.toLowerCase();
  if (env && env in LOG_LEVELS) {
    return env as LogLevel;
  }
  return 'info';
}

const configuredLevel = getConfiguredLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatMessage(level: LogLevel, component: string, message: string, data?: unknown): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
  };
  if (data !== undefined) {
    entry['data'] = data;
  }
  return JSON.stringify(entry);
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: unknown): void {
      if (shouldLog('debug')) {
        process.stderr.write(formatMessage('debug', component, message, data) + '\n');
      }
    },
    info(message: string, data?: unknown): void {
      if (shouldLog('info')) {
        process.stderr.write(formatMessage('info', component, message, data) + '\n');
      }
    },
    warn(message: string, data?: unknown): void {
      if (shouldLog('warn')) {
        process.stderr.write(formatMessage('warn', component, message, data) + '\n');
      }
    },
    error(message: string, data?: unknown): void {
      if (shouldLog('error')) {
        process.stderr.write(formatMessage('error', component, message, data) + '\n');
      }
    },
  };
}
