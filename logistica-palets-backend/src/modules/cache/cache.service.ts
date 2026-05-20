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
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client!: Redis;
  private _ready = false;

  onModuleInit() {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);

    this.client = new Redis({
      host,
      port,
      lazyConnect: true,
      enableReadyCheck: true,
      // Disable auto-reconnect to avoid log noise when Redis is optional
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => (times < 3 ? 500 : null), // give up after 3
    });

    this.client.on('ready', () => {
      this._ready = true;
      this.logger.log(`Redis connected at ${host}:${port}`);
    });

    this.client.on('error', (err: Error) => {
      this._ready = false;
      this.logger.warn(`Redis error (cache disabled): ${err.message}`);
    });

    this.client.on('close', () => {
      this._ready = false;
    });

    // Non-blocking connect — if Redis is down, the app still starts
    void this.client.connect().catch((err: Error) => {
      this.logger.warn(`Redis initial connect failed: ${err.message}`);
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
