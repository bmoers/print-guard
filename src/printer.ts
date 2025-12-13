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
  jobSubmitted: (info: { filename: string }) => void;
  printStarted: (info: { filename: string }) => void;
  jobComplete: (info: { filename: string; durationSeconds: number; materialUsedMm: number }) => void;
  jobCancelled: (info: { filename: string; durationSeconds: number; materialUsedMm: number }) => void;
}

enum JobState {
  IDLE = 'IDLE',
  SUBMITTED = 'SUBMITTED',
  PRINTING = 'PRINTING',
}

export class PrinterClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private currentStatus: PrinterStatus = {};
  private wasConnected = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private jobState: JobState = JobState.IDLE;

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
        this.startHeartbeat();
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        log(`Received message: ${data.toString()}`, 'debug');
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.stopHeartbeat();
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
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const msg = JSON.stringify({
          ModeCode: 'heart_beat',
          msg: new Date().toISOString(),
        });
        this.ws.send(msg);
        log('Heartbeat sent', 'debug');
      }
    }, 6000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getStatus(): PrinterStatus {
    return { ...this.currentStatus };
  }

  private handleMessage(data: string): void {
    if (data === 'ok') {
      return;
    }

    try {
      const message = JSON.parse(data);
      this.updateStatus(message);
      this.checkJobEvents();
    } catch (error) {
      log(`Failed to parse message: ${data}`, 'debug');
    }
  }

  // Updates currentStatus from WebSocket message - NO event detection here
  private updateStatus(message: Record<string, unknown>): void {
    if (message.nozzleTemp !== undefined) {
      this.currentStatus.nozzleTemp = parseFloat(message.nozzleTemp as string);
    }
    if (message.bedTemp0 !== undefined) {
      this.currentStatus.bedTemp = parseFloat(message.bedTemp0 as string);
    }
    if (message.printProgress !== undefined) {
      this.currentStatus.printProgress = message.printProgress as number;
    }
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
  }

  // Checks for job state transitions and emits events
  private checkJobEvents(): void {
    const { deviceState, state, printProgress } = this.currentStatus;

    // IDLE → SUBMITTED: deviceState=1 && state=1
    if (this.jobState === JobState.IDLE) {
      if (deviceState === 1 && state === 1) {
        this.jobState = JobState.SUBMITTED;
        this.emitJobSubmitted();
      }
      return;
    }

    // SUBMITTED → PRINTING: printProgress > 0
    if (this.jobState === JobState.SUBMITTED) {
      if (printProgress !== undefined && printProgress > 0 && printProgress < 50) {
        this.jobState = JobState.PRINTING;
        this.emitPrintStarted();
      }
      // SUBMITTED → CANCELLED: deviceState=0
      if (deviceState === 0) {
        this.jobState = JobState.IDLE;
        this.emitJobCancelled();
      }
      return;
    }

    // PRINTING → COMPLETE: printProgress=100
    if (this.jobState === JobState.PRINTING) {
      if (printProgress === 100) {
        this.jobState = JobState.IDLE;
        this.resetJobStatus();
        this.emitJobComplete();
        return;
      }
      // PRINTING → CANCELLED: deviceState=0
      if (deviceState === 0) {
        this.jobState = JobState.IDLE;
        this.resetJobStatus();
        this.emitJobCancelled();
      }
    }
  }

  // Reset cached status values to prevent false re-triggers
  private resetJobStatus(): void {
    this.currentStatus.deviceState = undefined;
    this.currentStatus.state = undefined;
    this.currentStatus.printProgress = undefined;
  }

  private emitJobSubmitted(): void {
    const filename = this.currentStatus.filename || 'Unknown file';
    log(`Job submitted: ${filename}`);
    this.emit('jobSubmitted', { filename });
  }

  private emitPrintStarted(): void {
    const filename = this.currentStatus.filename || 'Unknown file';
    log(`Print started: ${filename}`);
    this.emit('printStarted', { filename });
  }

  private emitJobComplete(): void {
    const filename = this.currentStatus.filename || 'Unknown file';
    const durationSeconds = this.currentStatus.printJobTime || 0;
    const materialUsedMm = this.currentStatus.usedMaterialLength || 0;

    log(`Job complete: ${filename} (${durationSeconds}s)`);
    this.emit('jobComplete', { filename, durationSeconds, materialUsedMm });
  }

  private emitJobCancelled(): void {
    const filename = this.currentStatus.filename || 'Unknown file';
    const durationSeconds = this.currentStatus.printJobTime || 0;
    const materialUsedMm = this.currentStatus.usedMaterialLength || 0;

    log(`Job cancelled: ${filename} (${durationSeconds}s)`);
    this.emit('jobCancelled', { filename, durationSeconds, materialUsedMm });
  }
}
