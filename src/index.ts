import { PrinterClient } from './printer';
import { sendJobComplete, sendJobCancelled, sendJobSubmitted, sendStartup, sendPrinterOnline, sendPrintStarted } from './slack';
import { config } from './config';
import { log } from './logger';
import { captureSnapshot, isSnapshotEnabled } from './snapshot';

enum MonitorState {
  OFFLINE = 'OFFLINE',
  CONNECTING = 'CONNECTING',
  IDLE = 'IDLE',
  PRINTING = 'PRINTING',
}

class PrintMonitor {
  private printer: PrinterClient;
  private state: MonitorState = MonitorState.OFFLINE;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.printer = new PrinterClient();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.printer.on('connected', async () => {
      this.state = MonitorState.IDLE;
      log(`State: ${this.state}`);
      this.clearReconnectTimer();
      await sendPrinterOnline();
    });

    this.printer.on('disconnected', () => {
      this.state = MonitorState.OFFLINE;
      log(`State: ${this.state}`);
      this.scheduleReconnect();
    });

    this.printer.on('jobSubmitted', async (info) => {
      log(`Job submitted: ${info.filename}`);
      this.state = MonitorState.PRINTING;
      log(`State: ${this.state} (heating)`);
      await sendJobSubmitted(info.filename);
    });

    this.printer.on('printStarted', async (info) => {
      log(`Print started: ${info.filename}`);
      this.state = MonitorState.PRINTING;
      log(`State: ${this.state} (printing)`);
      const image = config.images.onPrintStarted ? await captureSnapshot() : null;
      await sendPrintStarted(info.filename, image);
    });

    this.printer.on('jobComplete', async (info) => {
      log(`Job completed: ${info.filename}`);
      this.state = MonitorState.IDLE;
      log(`State: ${this.state}`);

      const image = config.images.onJobComplete ? await captureSnapshot() : null;
      await sendJobComplete({
        filename: info.filename,
        durationSeconds: info.durationSeconds,
        materialUsedMm: info.materialUsedMm,
      }, image);
    });

    this.printer.on('jobCancelled', async (info) => {
      log(`Job cancelled: ${info.filename}`);
      this.state = MonitorState.IDLE;
      log(`State: ${this.state}`);

      const image = config.images.onJobCancelled ? await captureSnapshot() : null;
      await sendJobCancelled({
        filename: info.filename,
        durationSeconds: info.durationSeconds,
        materialUsedMm: info.materialUsedMm,
      }, image);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const interval = config.polling.offlineInterval;
    log(`Scheduling reconnect in ${interval / 1000} seconds`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, interval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  connect(): void {
    this.state = MonitorState.CONNECTING;
    log(`State: ${this.state}`);
    this.printer.connect();
  }

  stop(): void {
    log('Stopping monitor...');
    this.clearReconnectTimer();
    this.printer.disconnect();
  }

  async start(): Promise<void> {
    log('Starting print monitor...');
    log(`Printer URL: ${config.printer.wsUrl}`);
    log(`Offline poll interval: ${config.polling.offlineInterval / 1000}s`);
    if (isSnapshotEnabled()) {
      log(`Snapshots enabled: ${config.printer.snapshotUrl}`);
      log(`Snapshot delay: ${config.snapshot.delayMs}ms`);
    } else {
      log('Snapshots disabled (PRINTER_SNAPSHOT_URL not set)');
    }
    await sendStartup();
    this.connect();
  }
}

const monitor = new PrintMonitor();

process.on('SIGINT', () => {
  log('Received SIGINT, shutting down...');
  monitor.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, shutting down...');
  monitor.stop();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`, 'error');
});

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'error');
});

monitor.start().catch((error) => {
  log(`Failed to start: ${error}`, 'error');
});
