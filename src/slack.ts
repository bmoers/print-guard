import { WebClient } from '@slack/web-api';
import { config } from './config';
import { log } from './logger';

const client = new WebClient(config.slack.botToken);

async function uploadImageWithMessage(
  message: string,
  image: Buffer,
  filename: string
): Promise<boolean> {
  try {
    await client.filesUploadV2({
      channel_id: config.slack.channelId,
      file: image,
      filename: filename,
      initial_comment: message,
    });
    return true;
  } catch (error) {
    log(`Failed to upload image: ${error}`, 'error');
    return false;
  }
}

export interface JobCompleteInfo {
  filename: string;
  durationSeconds?: number;
  materialUsedMm?: number;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function extractFilename(path: string): string {
  return path.split('/').pop() || path;
}

export async function sendStartup(): Promise<boolean> {
  if (!config.notifications.startup) {
    log('Startup notification disabled');
    return true;
  }
  try {
    await client.chat.postMessage({
      channel: config.slack.channelId,
      text: ':rocket: *PrintGuard started* - watching for print jobs.',
      mrkdwn: true,
    });
    log('Startup notification sent');
    return true;
  } catch (error) {
    log(`Failed to send startup notification: ${error}`, 'error');
    return false;
  }
}

export async function sendPrinterOnline(): Promise<boolean> {
  if (!config.notifications.printerOnline) {
    log('Printer online notification disabled');
    return true;
  }
  try {
    await client.chat.postMessage({
      channel: config.slack.channelId,
      text: ':electric_plug: *Printer online* - connected and ready.',
      mrkdwn: true,
    });
    log('Printer online notification sent');
    return true;
  } catch (error) {
    log(`Failed to send notification: ${error}`, 'error');
    return false;
  }
}

export async function sendPrintStarted(
  filename: string,
  image?: Buffer | null
): Promise<boolean> {
  if (!config.notifications.printStarted) {
    log('Print started notification disabled');
    return true;
  }
  const name = extractFilename(filename);
  const message = `:printer: *Print started*\n\n:page_facing_up: *File:* \`${name}\``;

  try {
    if (image) {
      const success = await uploadImageWithMessage(
        message,
        image,
        `print-start-${Date.now()}.jpg`
      );
      if (success) {
        log('Print started notification with image sent');
        return true;
      }
      // Fall through to text-only if image upload failed
    }

    await client.chat.postMessage({
      channel: config.slack.channelId,
      text: message,
      mrkdwn: true,
    });
    log('Print started notification sent');
    return true;
  } catch (error) {
    log(`Failed to send notification: ${error}`, 'error');
    return false;
  }
}

export async function sendJobComplete(
  info: JobCompleteInfo,
  image?: Buffer | null
): Promise<boolean> {
  if (!config.notifications.jobComplete) {
    log('Job complete notification disabled');
    return true;
  }
  const filename = extractFilename(info.filename);

  let message = `:white_check_mark: *Print Complete!*\n\n:page_facing_up: *File:* \`${filename}\``;

  if (info.durationSeconds) {
    message += `\n:stopwatch: *Duration:* ${formatDuration(info.durationSeconds)}`;
  }

  if (info.materialUsedMm) {
    const meters = (info.materialUsedMm / 1000).toFixed(2);
    message += `\n:thread: *Material:* ${meters}m`;
  }

  try {
    if (image) {
      const success = await uploadImageWithMessage(
        message,
        image,
        `print-complete-${Date.now()}.jpg`
      );
      if (success) {
        log('Slack notification with image sent successfully');
        return true;
      }
      // Fall through to text-only if image upload failed
    }

    await client.chat.postMessage({
      channel: config.slack.channelId,
      text: message,
      mrkdwn: true,
    });
    log('Slack notification sent successfully');
    return true;
  } catch (error) {
    log(`Failed to send Slack notification: ${error}`, 'error');
    return false;
  }
}

