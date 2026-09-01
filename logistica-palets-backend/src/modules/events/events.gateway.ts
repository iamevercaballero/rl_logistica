import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { WarehouseAccessService } from '../warehouses/warehouse-access.service';
import { wasIssuedBeforePasswordChange } from '../auth/token-freshness';
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

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly access: WarehouseAccessService,
  ) {}

  /** Sala de los usuarios con alcance global — reciben todo. */
  private static readonly SALA_GLOBAL = 'scope:all';

  /** Sala de un depósito concreto. */
  private static sala(warehouseId: string): string {
    return `wh:${warehouseId}`;
  }

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

  /**
   * Valida un token contra la base con el MISMO criterio que el camino HTTP
   * (`jwt.strategy.ts`): que el usuario exista, esté activo, y que el token no
   * sea anterior al último cambio de contraseña o cierre de sesiones.
   *
   * Antes el gateway se conformaba con que la firma fuera válida y tomaba el rol
   * del propio token. Una firma válida sólo prueba que el token se emitió acá,
   * no que siga vigente: un usuario dado de baja —o degradado de rol— conservaba
   * su conexión y su rol viejo hasta que el token expirara, ocho horas después.
   */
  private async validarToken(token: string): Promise<{ userId: string; username: string; role: string } | null> {
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'dev_secret_fallback',
      });
      const user = await this.users.findByUsername(payload.username);
      if (!user || !user.active) return null;
      if (wasIssuedBeforePasswordChange(payload.iat, user.passwordChangedAt)) return null;
      // El rol vigente en la base manda sobre el que viaja en el token.
      return { userId: user.id, username: user.username, role: user.role };
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    const usuario = token ? await this.validarToken(token) : null;
    if (!usuario) {
      this.logger.warn(`WS conexión rechazada (auth inválida): ${client.id}`);
      client.disconnect(true);
      return;
    }
    client.data.user = usuario;
    // El token se guarda para poder revalidar la conexión mientras vive: sin
    // esto, una baja de usuario no cortaba la sesión ya establecida.
    client.data.token = token;

    // Salas por alcance: hasta acá `server.emit` difundía cada movimiento y cada
    // cambio de stock a TODOS los conectados, así que un operador del depósito
    // 02 veía la actividad del 01 — metadatos de otro depósito que por HTTP no
    // podría consultar.
    const permitidos = await this.access.getAllowedWarehouseIds(usuario);
    if (permitidos === null) {
      await client.join(EventsGateway.SALA_GLOBAL);
    } else {
      for (const warehouseId of permitidos) await client.join(EventsGateway.sala(warehouseId));
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

  /**
   * Destinatarios de un evento: los de alcance global siempre, y además los
   * asignados al depósito que el evento toca.
   *
   * Un evento sin depósito llega sólo a los de alcance global — mismo criterio
   * que el resto de la app para las entidades sin depósito asignado.
   */
  private destinatarios(warehouseId?: string | null) {
    const salas = warehouseId
      ? [EventsGateway.SALA_GLOBAL, EventsGateway.sala(warehouseId)]
      : [EventsGateway.SALA_GLOBAL];
    return this.server?.to(salas);
  }

  /** Broadcast when a new movement is successfully persisted. */
  emitMovementCreated(payload: MovementCreatedPayload): void {
    this.destinatarios(payload.warehouseId)?.emit('movement:created', payload);
  }

  /**
   * Broadcast when stock levels change.
   * The Dashboard listens to this and invalidates its queries immediately.
   */
  emitStockUpdated(payload: StockUpdatedPayload): void {
    this.destinatarios(payload.warehouseId)?.emit('stock:updated', payload);
  }

  /**
   * Revalida las conexiones vivas y desconecta las que dejaron de serlo.
   *
   * Validar sólo al conectar no alcanza: dar de baja a un usuario, cambiarle la
   * contraseña o cerrarle las sesiones no cortaba una conexión ya establecida,
   * que sobrevivía hasta que el token expirara —ocho horas—. Acá se cierra esa
   * ventana a cinco minutos.
   *
   * El barrido recorre los sockets conectados, que son unos pocos: una consulta
   * indexada por usuario cada cinco minutos es despreciable.
   */
  @Interval(5 * 60_000)
  async revalidarConexiones(): Promise<void> {
    if (!this.server) return;
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      const token = socket.data?.token as string | undefined;
      if (!token) continue;
      if (await this.validarToken(token)) continue;
      this.logger.warn(`WS conexión revocada (usuario dado de baja o sesión invalidada): ${socket.id}`);
      socket.disconnect(true);
    }
  }

  get clientCount(): number {
    return this.connectedClients;
  }
}
