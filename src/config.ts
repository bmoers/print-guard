import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

export const config = {
  slack: {
    botToken: requireEnv('SLACK_BOT_TOKEN'),
    channelId: requireEnv('SLACK_CHANNEL_ID'),
  },
  printer: {
    wsUrl: requireEnv('PRINTER_WS_URL'),
    snapshotUrl: process.env.PRINTER_SNAPSHOT_URL || null,
  },
  snapshot: {
    delayMs: parseInt(optionalEnv('SNAPSHOT_DELAY_MS', '3000'), 10),
  },
  polling: {
    offlineInterval: parseInt(optionalEnv('OFFLINE_POLL_INTERVAL', '300000'), 10),
  },
  notifications: {
    startup: boolEnv('NOTIFY_STARTUP', true),
    printerOnline: boolEnv('NOTIFY_PRINTER_ONLINE', true),
    jobSubmitted: boolEnv('NOTIFY_JOB_SUBMITTED', true),
    printStarted: boolEnv('NOTIFY_PRINT_STARTED', true),
    jobComplete: boolEnv('NOTIFY_JOB_COMPLETE', true),
    jobCancelled: boolEnv('NOTIFY_JOB_CANCELLED', true),
  },
  images: {
    onPrintStarted: boolEnv('IMAGE_ON_PRINT_STARTED', true),
    onJobComplete: boolEnv('IMAGE_ON_JOB_COMPLETE', true),
    onJobCancelled: boolEnv('IMAGE_ON_JOB_CANCELLED', true),
  },
  web: {
    port: parseInt(optionalEnv('WEB_PORT', '3000'), 10),
    enabled: boolEnv('WEB_ENABLED', true),
  },
} as const;

export type Config = typeof config;
