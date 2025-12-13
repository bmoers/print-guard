# PrintGuard

[![CI](https://github.com/bmoers/print-guard/actions/workflows/main.yml/badge.svg)](https://github.com/bmoers/print-guard/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Node.js/TypeScript application that monitors a Creality Ender V3 3D printer via WebSocket and sends Slack notifications with optional camera snapshots when print jobs start and complete.

## Features

- Real-time printer monitoring via WebSocket
- Slack notifications for:
  - Monitor startup
  - Printer online/offline status
  - Print job submitted (heating phase)
  - Print job started (with optional camera snapshot)
  - Print job completed (with optional camera snapshot)
  - Print job cancelled (with optional camera snapshot)
- Configurable notification toggles
- Automatic reconnection when printer goes offline
- Camera snapshot support with configurable delay
- Heartbeat mechanism for reliable WebSocket connection
- Docker support with multi-arch images (arm64/amd64)

## Requirements

- Node.js 18+ (or Docker)
- Creality Ender V3 printer with network connectivity
- Slack Bot Token with `chat:write` and `files:write` permissions
- (Optional) Camera with HTTP snapshot endpoint

## Quick Start with Docker

The easiest way to run PrintGuard is using the pre-built Docker image:

```bash
# Create your .env file (see Configuration below)
curl -O https://raw.githubusercontent.com/bmoers/print-guard/main/.env.example
cp .env.example .env
# Edit .env with your values

# Run with Docker
docker run -d --name print-guard --env-file .env ghcr.io/bmoers/print-guard:latest
```

Or using Docker Compose:

```yaml
# docker-compose.yml
services:
  print-guard:
    image: ghcr.io/bmoers/print-guard:latest
    container_name: print-guard
    restart: unless-stopped
    env_file:
      - .env
```

```bash
docker compose up -d
```

## Installation from Source

```bash
git clone https://github.com/bmoers/print-guard.git
cd print-guard
npm install
```

## Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

### Required Settings

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack Bot OAuth token (starts with `xoxb-`) |
| `SLACK_CHANNEL_ID` | Slack channel ID for notifications (starts with `C`) |

### Optional Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PRINTER_WS_URL` | `ws://192.168.1.66:9999/` | Printer WebSocket URL |
| `OFFLINE_POLL_INTERVAL` | `300000` (5 min) | Reconnect interval when offline (ms) |
| `PRINTER_SNAPSHOT_URL` | - | Camera snapshot URL (disabled if empty) |
| `SNAPSHOT_DELAY_MS` | `3000` | Delay before capturing snapshot (ms) |

### Notification Toggles

Control which notifications are sent (all default to `true`):

| Variable | Description |
|----------|-------------|
| `NOTIFY_STARTUP` | Send message when monitor starts |
| `NOTIFY_PRINTER_ONLINE` | Send message when printer connects |
| `NOTIFY_JOB_SUBMITTED` | Send message when print job is received (heating) |
| `NOTIFY_PRINT_STARTED` | Send message when print job begins |
| `NOTIFY_JOB_COMPLETE` | Send message when print job finishes |
| `NOTIFY_JOB_CANCELLED` | Send message when print job is cancelled |

### Image Toggles

Control camera snapshots in notifications (requires `PRINTER_SNAPSHOT_URL`):

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_ON_PRINT_STARTED` | `true` | Attach snapshot when print starts |
| `IMAGE_ON_JOB_COMPLETE` | `true` | Attach snapshot when print completes |
| `IMAGE_ON_JOB_CANCELLED` | `true` | Attach snapshot when print is cancelled |

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Docker Commands

```bash
docker compose up -d       # Run in background
docker compose logs -f     # View logs
docker compose down        # Stop
docker compose build       # Rebuild after changes
```

## Architecture

```
src/
├── index.ts      # Entry point, monitor state machine
├── printer.ts    # WebSocket client with job state machine
├── slack.ts      # Slack API integration with image upload
├── snapshot.ts   # Camera snapshot capture with retry logic
├── config.ts     # Environment variable loading and validation
└── logger.ts     # Timestamped console logging
```

### Monitor State Machine (index.ts)

```
OFFLINE ──(connect)──> CONNECTING ──(connected)──> IDLE
   ↑                                                 │
   │                                                 │
   └──────────(disconnected)─────────────────────────┘
                                                     │
                                            (job submitted)
                                                     ↓
                                                PRINTING
                                                     │
                                       (complete or cancelled)
                                                     ↓
                                                  IDLE
```

### Job State Machine (printer.ts)

Tracks print job lifecycle through WebSocket messages:

```
IDLE ──(deviceState=1 && state=1)──> SUBMITTED ──(progress > 0)──> PRINTING
                                          │                            │
                                          │                            │
                                   (deviceState=0)              (progress=100)
                                          │                            │
                                          ↓                            ↓
                                     CANCELLED                     COMPLETE
                                          │                            │
                                          └────────> IDLE <────────────┘
```

**Events emitted:**

- `jobSubmitted` - Print job received, printer heating
- `jobComplete` - Print finished successfully (progress = 100%)
- `jobCancelled` - Print stopped before completion (deviceState = 0)

## WebSocket Protocol

PrintGuard communicates with the printer via WebSocket. Key details for contributors:

### Heartbeat

The client sends a heartbeat every 6 seconds to maintain the connection:

```json
{"ModeCode":"heart_beat","msg":"2025-01-15T10:30:00.000Z"}
```

The printer responds with `ok`.

### Status Messages

The printer sends partial JSON updates with various fields:

| Field | Type | Description |
|-------|------|-------------|
| `deviceState` | number | 0 = idle, 1 = busy |
| `state` | number | 0 = idle, 1 = printing, 2 = complete |
| `printProgress` | number | 0-100 percentage |
| `nozzleTemp` | string | Current nozzle temperature |
| `bedTemp0` | string | Current bed temperature |
| `printLeftTime` | number | Remaining time in seconds |
| `printJobTime` | number | Elapsed time in seconds |
| `filename` / `printFileName` / `curPrintFile` | string | Current file being printed |

### Job Detection Logic

- **Job Submitted**: `deviceState=1` AND `state=1`
- **Print Started**: `printProgress > 0` AND `printProgress < 50`
- **Job Complete**: `printProgress = 100`
- **Job Cancelled**: `deviceState = 0` while in SUBMITTED or PRINTING state

## Slack Bot Setup

1. Create a new Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Navigate to **OAuth & Permissions** and add these Bot Token Scopes:
   - `chat:write` - Send messages
   - `files:write` - Upload images
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token** to `SLACK_BOT_TOKEN`
5. Invite the bot to your channel (`/invite @YourBotName`)
6. Get the Channel ID (right-click channel → View channel details → scroll to bottom) and set `SLACK_CHANNEL_ID`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with ts-node (development) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JavaScript (production) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checker |

## License

MIT
