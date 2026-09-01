import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { corsOriginCallback } from '../../config/cors';

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
    // Misma lista que la API, y evaluada por conexión. Antes se pasaba
    // `CORS_ORIGIN` cruda: con más de un dominio el navegador comparaba su
    // origen contra la cadena entera y el WebSocket no conectaba para nadie.
    // Y sin la variable caía en `'*'` junto a `credentials: true`, que el
    // estándar CORS prohíbe. Ver `src/config/cors.ts`.
    origin: corsOriginCallback,
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

  constructor(private readonly jwt: JwtService) {}

  afterInit() {
    this.logger.log('WebSocket gateway initialized — namespace: /events');
  }

  /**
   * Extrae el JWT del handshake. Acepta:
   *  - handshake.auth.token  (socket.io-client: io(url, { auth: { token } }))
   *  - header Authorization: Bearer <token>
   */
  private extractToken(client: Socket): string | undefined {
    const authToken = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (authToken) return authToken.replace(/^Bearer\s+/i, '');

    const header = client.handshake.headers?.authorization;
    if (header) return header.replace(/^Bearer\s+/i, '');

    return undefined;
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('token ausente');

      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'dev_secret_fallback',
      });
      // Adjunta el usuario al socket para autorización futura por evento.
      client.data.user = {
        userId: payload.sub,
        username: payload.username,
        role: payload.role,
      };
    } catch {
      this.logger.warn(`WS conexión rechazada (auth inválida): ${client.id}`);
      client.disconnect(true);
      return;
    }

    this.connectedClients++;
    this.logger.debug(
      `WS client connected: ${client.id} (total: ${this.connectedClients})`,
    );
  }

  handleDisconnect(client: Socket) {
    // Sólo descontar conexiones que llegaron a autenticarse (las rechazadas en
    // handleConnection también disparan 'disconnect' pero nunca se contaron).
    if (!client.data.user) return;
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
