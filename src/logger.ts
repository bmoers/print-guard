type LogLevel = 'info' | 'error' | 'warn' | 'debug';

function getTimestamp(): string {
  return new Date().toISOString();
}

export function log(message: string, level: LogLevel = 'info'): void {
  const timestamp = getTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  switch (level) {
    case 'error':
      console.error(`${prefix} ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`);
      break;
    case 'debug':
      if (process.env.DEBUG) {
        console.log(`${prefix} ${message}`);
      }
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}
