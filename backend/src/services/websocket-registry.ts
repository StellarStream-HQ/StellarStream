/**
 * WebSocket Registry
 *
 * Lightweight singleton accessor for the shared WebSocketService instance.
 * Avoids circular imports: `src/index.ts` creates the Socket.IO server and
 * registers the instance here; services (e.g. DisputeService) can then emit
 * real-time events without importing the Express entrypoint.
 */

import type { WebSocketService } from "./websocket.service.js";

let _ws: WebSocketService | null = null;

export function setWebSocketService(ws: WebSocketService | null): void {
    _ws = ws;
}

export function getWebSocketService(): WebSocketService | null {
    return _ws;
}

