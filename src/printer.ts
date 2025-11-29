import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from './config';
import { log } from './logger';

export interface PrinterStatus {
  nozzleTemp?: number;
  bedTemp?: number;
  printProgress?: number;
  printLeftTime?: number;
  printJobTime?: number;
  curPosition?: string;
  state?: number;
  deviceState?: number;
  filename?: string;
  usedMaterialLength?: number;
}

export interface PrinterEvents {
  connected: () => void;
  disconnected: () => void;
  status: (status: PrinterStatus) => void;
  jobComplete: (info: { filename: string; durationSeconds: number; materialUsedMm: number }) => void;
  heartbeat: () => void;
}

export class PrinterClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private currentStatus: PrinterStatus = {};
  private lastCompletedJobTime: number | null = null;
  private wasConnected = false;
  private seenPrintInProgress = false;

  constructor() {
    super();
  }

  connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    log(`Connecting to printer at ${config.printer.wsUrl}`);

    try {
      this.ws = new WebSocket(config.printer.wsUrl);

      this.ws.on('open', () => {
        log('Connected to printer');
        this.wasConnected = true;
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        if (this.wasConnected) {
          log('Disconnected from printer');
          this.wasConnected = false;
        }
        this.ws = null;
        this.emit('disconnected');
      });

      this.ws.on('error', (error: Error) => {
        log(`WebSocket error: ${error.message}`, 'error');
      });
    } catch (error) {
      log(`Failed to create WebSocket connection: ${error}`, 'error');
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getStatus(): PrinterStatus {
    return { ...this.currentStatus };
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.ModeCode === 'heart_beat') {
        this.emit('heartbeat');
        log('Heartbeat received', 'debug');
        return;
      }

      this.updateStatus(message);

      if (this.isJobComplete(message)) {
        this.handleJobComplete(message);
      }
    } catch (error) {
      log(`Failed to parse message: ${data}`, 'debug');
    }
  }

  private updateStatus(message: Record<string, unknown>): void {
    if (message.nozzleTemp !== undefined) {
      this.currentStatus.nozzleTemp = parseFloat(message.nozzleTemp as string);
    }
    if (message.bedTemp0 !== undefined) {
      this.currentStatus.bedTemp = parseFloat(message.bedTemp0 as string);
    }
    if (message.printProgress !== undefined) {
      const progress = message.printProgress as number;
      this.currentStatus.printProgress = progress;

      if (progress > 0 && progress < 100) {
        if (!this.seenPrintInProgress) {
          log(`Print in progress detected (${progress}%)`);
          this.seenPrintInProgress = true;
        }
      }
    }

    // Check for current print filename in various possible fields
    if (message.filename !== undefined) {
      this.currentStatus.filename = message.filename as string;
    }
    if (message.fileName !== undefined) {
      this.currentStatus.filename = message.fileName as string;
    }
    if (message.printFileName !== undefined) {
      this.currentStatus.filename = message.printFileName as string;
    }
    if (message.curPrintFile !== undefined) {
      this.currentStatus.filename = message.curPrintFile as string;
    }
    if (message.printLeftTime !== undefined) {
      this.currentStatus.printLeftTime = message.printLeftTime as number;
    }
    if (message.printJobTime !== undefined) {
      this.currentStatus.printJobTime = message.printJobTime as number;
    }
    if (message.curPosition !== undefined) {
      this.currentStatus.curPosition = message.curPosition as string;
    }
    if (message.state !== undefined) {
      this.currentStatus.state = message.state as number;
    }
    if (message.deviceState !== undefined) {
      this.currentStatus.deviceState = message.deviceState as number;
    }
    if (message.usedMaterialLength !== undefined) {
      this.currentStatus.usedMaterialLength = message.usedMaterialLength as number;
    }

    if (message.historyList && Array.isArray(message.historyList) && message.historyList.length > 0) {
      const latestJob = message.historyList[0] as Record<string, unknown>;
      if (latestJob.filename) {
        this.currentStatus.filename = latestJob.filename as string;
      }
    }

    this.emit('status', this.currentStatus);
  }

  private isJobComplete(message: Record<string, unknown>): boolean {
    return (
      message.printProgress === 100 &&
      message.printLeftTime === 0 &&
      message.printJobTime !== undefined
    );
  }

  private handleJobComplete(message: Record<string, unknown>): void {
    const jobTime = message.printJobTime as number;

    if (!this.seenPrintInProgress) {
      log('Job complete signal ignored (no print was in progress this session)', 'debug');
      return;
    }

    if (this.lastCompletedJobTime === jobTime) {
      log('Duplicate job complete event ignored', 'debug');
      return;
    }

    this.lastCompletedJobTime = jobTime;
    this.seenPrintInProgress = false;

    const filename = this.currentStatus.filename || 'Unknown file';
    const materialUsedMm = this.currentStatus.usedMaterialLength || 0;

    log(`Job complete: ${filename} (${jobTime}s)`);

    this.emit('jobComplete', {
      filename,
      durationSeconds: jobTime,
      materialUsedMm,
    });
  }
}
