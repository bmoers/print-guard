import express from 'express';
import path from 'path';
import { config } from './config';
import { log } from './logger';
import type { PrinterClient } from './printer';

interface WebServerDeps {
  printer: PrinterClient;
  getMonitorState: () => string;
}

export function startWebServer(deps: WebServerDeps): void {
  const app = express();
  const { printer, getMonitorState } = deps;

  // Serve static files from public/
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // SSE endpoint for real-time status updates
  app.get('/api/status/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const sendStatus = () => {
      const status = printer.getStatus();
      const data = {
        ...status,
        monitorState: getMonitorState(),
        connected: printer.isConnected(),
        snapshotEnabled: config.printer.snapshotUrl !== null,
        timestamp: Date.now(),
      };
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send immediately, then every 2 seconds
    sendStatus();
    const interval = setInterval(sendStatus, 2000);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  // Snapshot proxy — avoids CORS issues for the camera feed
  app.get('/api/snapshot', async (_req, res) => {
    if (!config.printer.snapshotUrl) {
      res.status(404).json({ error: 'Snapshot URL not configured' });
      return;
    }

    try {
      const response = await fetch(config.printer.snapshotUrl);
      if (!response.ok) {
        res.status(502).json({ error: 'Failed to fetch snapshot from printer' });
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.end(buffer);
    } catch {
      res.status(502).json({ error: 'Camera unreachable' });
    }
  });

  // JSON status endpoint (for one-off requests)
  app.get('/api/status', (_req, res) => {
    const status = printer.getStatus();
    res.json({
      ...status,
      monitorState: getMonitorState(),
      connected: printer.isConnected(),
      snapshotEnabled: config.printer.snapshotUrl !== null,
      timestamp: Date.now(),
    });
  });

  app.listen(config.web.port, () => {
    log(`Web dashboard running at http://localhost:${config.web.port}`);
  });
}
