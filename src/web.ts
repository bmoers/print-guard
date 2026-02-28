import express from 'express';
import http from 'http';
import https from 'https';
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
        cameraMode: config.printer.streamUrl ? 'stream' : config.printer.snapshotUrl ? 'snapshot' : null,
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

  // MJPEG stream proxy — pipes the camera stream to avoid CORS
  app.get('/api/stream', (req, res) => {
    if (!config.printer.streamUrl) {
      res.status(404).json({ error: 'Stream URL not configured' });
      return;
    }

    const streamUrl = new URL(config.printer.streamUrl);
    const transport = streamUrl.protocol === 'https:' ? https : http;

    const proxyReq = transport.get(config.printer.streamUrl, (proxyRes) => {
      if (!proxyRes.statusCode || proxyRes.statusCode >= 400) {
        res.status(502).json({ error: 'Failed to connect to camera stream' });
        proxyRes.destroy();
        return;
      }

      // Forward content-type (multipart/x-mixed-replace) and pipe the stream
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'multipart/x-mixed-replace',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive',
      });

      proxyRes.pipe(res);

      // Clean up when client disconnects
      req.on('close', () => {
        proxyRes.destroy();
      });
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Camera stream unreachable' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  // JSON status endpoint (for one-off requests)
  app.get('/api/status', (_req, res) => {
    const status = printer.getStatus();
    res.json({
      ...status,
      monitorState: getMonitorState(),
      connected: printer.isConnected(),
      cameraMode: config.printer.streamUrl ? 'stream' : config.printer.snapshotUrl ? 'snapshot' : null,
      timestamp: Date.now(),
    });
  });

  app.listen(config.web.port, () => {
    log(`Web dashboard running at http://localhost:${config.web.port}`);
  });
}
