import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Best-effort Redis cache service.
 * If Redis is unreachable, all operations silently no-op so the app keeps
 * working (cache misses are handled gracefully by callers).
 */
/**
 * Espera antes del siguiente intento de reconexión, en milisegundos.
 *
 * Nunca devuelve `null`: en ioredis eso no pospone la reconexión, la cancela
 * de forma definitiva. Está separada de la clase para poder fijarlo por test —
 * es exactamente el defecto que tenía (`times < 3 ? 500 : null`), y no se ve
 * leyendo el código, sólo apagando Redis y volviéndolo a levantar.
 */
export const esperaDeReintento = (intentos: number): number =>
  Math.min(intentos * 500, 10_000);

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client!: Redis;
  private _ready = false;
  private caido = false;

  onModuleInit() {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);

    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      enableReadyCheck: true,
      // Los comandos fallan rápido: `get`/`set` no deben colgar una petición
      // HTTP porque la caché no esté disponible.
      maxRetriesPerRequest: 1,
      // Reintento indefinido, con espera creciente hasta 10 s.
      //
      // Antes era `(times) => (times < 3 ? 500 : null)`, y en ioredis devolver
      // `null` no pospone la reconexión: la cancela para siempre. Verificado
      // deteniendo y volviendo a levantar Redis contra un contenedor de prueba:
      // el cliente no se recuperaba y la caché quedaba muerta hasta reiniciar
      // el backend. Como todas las operaciones hacen no-op en silencio, la
      // única señal era que el sistema iba más lento.
      //
      // Desde que los contenedores tienen techo de memoria (RL-A-10), que el
      // kernel mate a Redis y Docker lo reinicie dejó de ser hipotético.
      retryStrategy: esperaDeReintento,
    });

    this.client.on('ready', () => {
      const sereconecta = this.caido;
      this._ready = true;
      this.caido = false;
      this.logger.log(
        sereconecta
          ? `Redis reconectado en ${host}:${port} — caché activa de nuevo`
          : `Redis conectado en ${host}:${port}`,
      );
    });

    // Se registra la caída, no cada reintento: con reintento indefinido, un
    // Redis apagado escribiría una línea cada diez segundos para siempre. La
    // recuperación la anuncia el handler de `ready`.
    this.client.on('error', (err: Error) => {
      this._ready = false;
      if (!this.caido) {
        this.caido = true;
        this.logger.warn(
          `Redis no responde; la caché queda desactivada y se sigue reintentando — ${err.message}`,
        );
      }
    });

    this.client.on('close', () => {
      this._ready = false;
    });

    // Conexión no bloqueante: si Redis está caído, la app arranca igual.
    void this.client.connect().catch(() => {
      /* el handler de `error` ya lo registró */
    });
  }

  onModuleDestroy() {
    void this.client.quit().catch(() => {});
  }

  get isReady(): boolean {
    return this._ready;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this._ready) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (!this._ready) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      /* silent – cache is best-effort */
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this._ready || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch {
      /* silent */
    }
  }

  /**
   * Delete all keys matching a glob pattern.
   * Uses SCAN to avoid blocking the server (unlike KEYS).
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this._ready) return;
    try {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        keys.push(...batch);
      } while (cursor !== '0');

      if (keys.length > 0) await this.client.del(...keys);
    } catch {
      /* silent */
    }
  }
}
