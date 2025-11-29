import { config } from './config';
import { log } from './logger';

async function fetchSnapshot(): Promise<Buffer> {
  const url = config.printer.snapshotUrl;
  if (!url) {
    throw new Error('Snapshot URL not configured');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function captureSnapshot(): Promise<Buffer | null> {
  if (!config.printer.snapshotUrl) {
    return null;
  }

  // Wait for configured delay before capturing
  if (config.snapshot.delayMs > 0) {
    log(`Waiting ${config.snapshot.delayMs}ms before capturing snapshot...`);
    await new Promise((resolve) => setTimeout(resolve, config.snapshot.delayMs));
  }

  // First attempt
  try {
    const image = await fetchSnapshot();
    log('Snapshot captured successfully');
    return image;
  } catch (error) {
    log(`Snapshot capture failed, retrying: ${error}`, 'error');
  }

  // Retry after 1 second
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const image = await fetchSnapshot();
    log('Snapshot captured on retry');
    return image;
  } catch (error) {
    log(`Snapshot capture failed on retry: ${error}`, 'error');
    return null;
  }
}

export function isSnapshotEnabled(): boolean {
  return config.printer.snapshotUrl !== null;
}
