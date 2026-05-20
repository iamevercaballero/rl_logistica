import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';

/* ── Event payload types ──────────────────────────────────────────────────── */

export interface MovementCreatedPayload {
  movementId: string;
  type: string;
  warehouseId?: string | null;
}

export interface StockUpdatedPayload {
  warehouseId?: string | null;
}

/* ── Gateway ──────────────────────────────────────────────────────────────── */

@WebSocketGateway({
  namespace: '/events',
  transports: ['websocket', 'polling'],
  cors: {
    // In production, restrict via CORS_ORIGIN env var
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedClients = 0;

  afterInit() {
    this.logger.log('WebSocket gateway initialized — namespace: /events');
  }

  handleConnection(client: Socket) {
    this.connectedClients++;
    this.logger.debug(
      `WS client connected: ${client.id} (total: ${this.connectedClients})`,
    );
  }

  handleDisconnect(client: Socket) {
    this.connectedClients--;
    this.logger.debug(
      `WS client disconnected: ${client.id} (total: ${this.connectedClients})`,
    );
  }

  /** Broadcast when a new movement is successfully persisted. */
  emitMovementCreated(payload: MovementCreatedPayload): void {
    this.server?.emit('movement:created', payload);
  }

  /**
   * Broadcast when stock levels change.
   * The Dashboard listens to this and invalidates its queries immediately.
   */
  emitStockUpdated(payload: StockUpdatedPayload): void {
    this.server?.emit('stock:updated', payload);
  }

  get clientCount(): number {
    return this.connectedClients;
  }
}
