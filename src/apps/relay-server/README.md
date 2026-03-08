# BitFun Relay Server

WebSocket relay server for BitFun Remote Connect. Bridges desktop (WebSocket) and mobile (HTTP) clients with E2E encryption support.

## Features

- Desktop connects via WebSocket, mobile via HTTP — relay bridges between them
- End-to-end encrypted message passthrough (server cannot decrypt)
- Correlation-based HTTP-to-WebSocket request-response matching
- Per-room mobile-web static file upload & serving (content-addressable, incremental)
- Heartbeat-based connection management with configurable room TTL
- Docker deployment ready with Caddy reverse proxy

## Quick Start

### Docker (Recommended)

```bash
# One-click deploy
bash deploy.sh
```

### What URL should I fill in BitFun Desktop?

In **Remote Connect → Self-Hosted → Server URL**, use one of:

- Direct relay port: `http://<YOUR_SERVER_IP>:9700`
- Reverse proxy on domain root: `https://relay.example.com`
- Reverse proxy with `/relay` prefix: `https://relay.example.com/relay`

`/relay` is **not mandatory**. It is only needed when your reverse proxy is configured with that path prefix.

### Manual

```bash
# From project root
cargo build --release -p bitfun-relay-server

# Run
RELAY_PORT=9700 ./target/release/bitfun-relay-server
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_PORT` | `9700` | Server listen port |
| `RELAY_STATIC_DIR` | `./static` | Path to mobile web static files (fallback SPA) |
| `RELAY_ROOM_WEB_DIR` | `/tmp/bitfun-room-web` | Directory for per-room uploaded mobile-web files |
| `RELAY_ROOM_TTL` | `3600` | Room TTL in seconds (0 = no expiry) |

## API Endpoints

### Health & Info

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (returns status, version, uptime, room/connection counts) |
| `/api/info` | GET | Server info (name, version, protocol_version) |

### Room Operations (Mobile HTTP → Desktop WS bridge)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms/:room_id/pair` | POST | Mobile initiates pairing — relay forwards to desktop via WS, waits for response |
| `/api/rooms/:room_id/command` | POST | Mobile sends encrypted command — relay forwards to desktop, returns response |

### Per-Room Mobile-Web File Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/rooms/:room_id/upload-web` | POST | Full upload: base64-encoded files keyed by path (10MB body limit) |
| `/api/rooms/:room_id/check-web-files` | POST | Incremental: check which files the server already has by hash |
| `/api/rooms/:room_id/upload-web-files` | POST | Incremental: upload only the missing files (10MB body limit) |
| `/r/:room_id/*path` | GET | Serve uploaded mobile-web static files for a room |

### WebSocket

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ws` | WebSocket | Desktop client connection endpoint |

## WebSocket Protocol (Desktop Only)

Only desktop clients connect via WebSocket. Mobile clients use the HTTP endpoints above.

### Desktop → Server (Inbound)

```json
// Create a room
{ "type": "create_room", "room_id": "optional-id", "device_id": "...", "device_type": "desktop", "public_key": "base64..." }

// Respond to a bridged HTTP request (pair or command)
{ "type": "relay_response", "correlation_id": "...", "encrypted_data": "base64...", "nonce": "base64..." }

// Heartbeat
{ "type": "heartbeat" }
```

### Server → Desktop (Outbound)

```json
// Room created confirmation
{ "type": "room_created", "room_id": "..." }

// Pair request forwarded from mobile HTTP
{ "type": "pair_request", "correlation_id": "...", "public_key": "base64...", "device_id": "...", "device_name": "..." }

// Encrypted command forwarded from mobile HTTP
{ "type": "command", "correlation_id": "...", "encrypted_data": "base64...", "nonce": "base64..." }

// Heartbeat acknowledgment
{ "type": "heartbeat_ack" }

// Error
{ "type": "error", "message": "..." }
```

## Self-Hosted Deployment

1. Clone the repository
2. Navigate to `src/apps/relay-server/`
3. Run `bash deploy.sh`
4. Configure DNS/firewall as needed
5. In BitFun desktop, select "Custom Server" and enter your server URL

### Deployment Checklist (Recommended)

1. Open required ports:
   - `9700` (relay direct access, optional if only via reverse proxy)
   - `80/443` (for Caddy reverse proxy)
2. Verify health endpoint:
   - `http://<server-ip>:9700/health`
3. Configure your final URL strategy:
   - root domain (`https://relay.example.com`) or
   - path prefix (`https://relay.example.com/relay`)
4. Fill the same URL into BitFun Desktop "Custom Server".

### About `src/apps/server` vs `src/apps/relay-server`

- Remote Connect self-hosted deployment uses **`src/apps/relay-server`**.
- `src/apps/server` is a different application and not the relay service used by mobile/desktop Remote Connect.

## Architecture

```
Mobile Phone ──HTTP POST──► Relay Server ◄──WebSocket── Desktop Client
                               │
                          E2E Encrypted
                          (server cannot
                           read messages)
```

The relay server bridges HTTP and WebSocket:

- **Desktop** connects via WebSocket, creates a room, and stays connected.
- **Mobile** sends HTTP POST requests (`/pair`, `/command`). The relay forwards them to the desktop over WS using correlation IDs, waits for the WS response, and returns it to mobile via HTTP.
- The relay only manages rooms and forwards opaque encrypted payloads. All encryption/decryption happens on the client side.
- Per-room mobile-web static files can be uploaded via the incremental upload API and served at `/r/:room_id/`.
