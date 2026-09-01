import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Observable, from, of, catchError, switchMap, throwError } from 'rxjs';
import type { Request } from 'express';
import { IdempotencyKey } from './idempotency-key.entity';
import { IDEMPOTENT_KEY } from './idempotent.decorator';

/** Cabecera estándar de facto para esto. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Cuánto se espera a que termine una petición en curso con la misma clave. */
const ESPERA_MAX_MS = 15_000;
const ESPERA_INTERVALO_MS = 150;

type UsuarioAutenticado = { userId: string };

/**
 * Hace idempotentes los endpoints marcados con `@Idempotent()` (RL-A-01).
 *
 * Flujo: se reserva la clave con un INSERT en su propia transacción — que es lo
 * que hace que una segunda petición concurrente choque contra el índice único
 * en vez de ejecutar el trabajo de nuevo—, se corre el handler, y se guarda la
 * respuesta para devolverla igual en los reintentos.
 *
 * Si la operación falla, la reserva se libera: un error transitorio (la base se
 * cayó un segundo, un timeout) tiene que poder reintentarse con la misma clave.
 * Sólo se recuerda lo que salió bien.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const marcado = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!marcado) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: UsuarioAutenticado }>();
    const clave = this.leerClave(req);

    // Sin cabecera se ejecuta como siempre. No se exige, para no romper a un
    // consumidor que todavía no la manda; el frontend la envía en todos los
    // formularios de escritura, que es donde está el riesgo real de duplicado.
    if (!clave || !req.user?.userId) return next.handle();

    const userId = req.user.userId;
    const endpoint = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');

    return from(this.reservar(clave, userId, endpoint, requestHash)).pipe(
      switchMap((reservada) =>
        reservada.yaResuelta
          ? of(reservada.respuesta)
          : next.handle().pipe(
              // Se espera a guardar la respuesta ANTES de emitirla. Con un
              // `tap` sin await la respuesta salía primero y la fila quedaba un
              // instante en IN_PROGRESS: si el proceso moría justo ahí, la clave
              // quedaba trabada hasta vencer por TTL, y un reintento inmediato
              // se iba al camino de espera en vez de recibir la copia. Cuesta un
              // UPDATE, que al lado de crear un movimiento no se nota.
              switchMap((respuesta) =>
                from(this.completar(userId, clave, respuesta)).pipe(switchMap(() => of(respuesta))),
              ),
              catchError((error: unknown) =>
                from(this.liberar(userId, clave)).pipe(switchMap(() => throwError(() => error))),
              ),
            ),
      ),
    );
  }

  private leerClave(req: Request): string | null {
    const bruto = req.headers[IDEMPOTENCY_HEADER];
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    const limpio = valor?.trim();
    if (!limpio) return null;
    // Más de 200 sólo puede ser un cliente roto; la columna es varchar(200).
    return limpio.slice(0, 200);
  }

  /**
   * Reserva la clave. Devuelve `yaResuelta` cuando esta petición es un reintento
   * de una que ya terminó (o que está terminando ahora mismo).
   */
  private async reservar(
    clave: string,
    userId: string,
    endpoint: string,
    requestHash: string,
  ): Promise<{ yaResuelta: boolean; respuesta?: unknown }> {
    const existente = await this.repo.findOne({ where: { userId, key: clave } });
    if (existente) {
      return { yaResuelta: true, respuesta: await this.resolver(existente, endpoint, requestHash) };
    }

    try {
      await this.repo.insert({ key: clave, userId, endpoint, requestHash, status: 'IN_PROGRESS' });
      return { yaResuelta: false };
    } catch (error) {
      // 23505: otra petición ganó la carrera entre el SELECT y el INSERT.
      if ((error as { code?: string }).code !== '23505') throw error;
      const ganadora = await this.repo.findOneOrFail({ where: { userId, key: clave } });
      return { yaResuelta: true, respuesta: await this.resolver(ganadora, endpoint, requestHash) };
    }
  }

  /** Respuesta guardada, o espera a la que está en curso. */
  private async resolver(
    fila: IdempotencyKey,
    endpoint: string,
    requestHash: string,
  ): Promise<unknown> {
    if (fila.endpoint !== endpoint || fila.requestHash !== requestHash) {
      throw new UnprocessableEntityException(
        'La clave de idempotencia ya se usó para otra operación. Usá una clave distinta por operación.',
      );
    }

    if (fila.status === 'COMPLETED') return this.parsear(fila.responseBody);

    // En curso: se espera y se devuelve su respuesta. Es el caso del doble clic
    // — responder con un error acá le mostraría una falla al operador por una
    // operación que en realidad está saliendo bien.
    const limite = Date.now() + ESPERA_MAX_MS;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, ESPERA_INTERVALO_MS));
      const actual = await this.repo.findOne({ where: { id: fila.id } });
      if (!actual) {
        // La primera falló y liberó la reserva. No se ejecuta acá: el cuerpo ya
        // se consumió y reintentar a ciegas sería adivinar.
        throw new ConflictException(
          'La operación anterior con esta clave falló. Volvé a enviarla para reintentar.',
        );
      }
      if (actual.status === 'COMPLETED') return this.parsear(actual.responseBody);
    }

    throw new ConflictException(
      'Ya hay una operación en curso con esta clave de idempotencia. Esperá a que termine.',
    );
  }

  private parsear(body?: string | null): unknown {
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  private async completar(userId: string, clave: string, respuesta: unknown): Promise<void> {
    try {
      await this.repo.update(
        { userId, key: clave },
        {
          status: 'COMPLETED',
          responseBody: JSON.stringify(respuesta ?? null),
          responseStatus: 201,
          completedAt: new Date(),
        },
      );
    } catch (error) {
      // Si no se pudo guardar, un reintento vuelve a ejecutar: es el
      // comportamiento que había antes de esto, no una regresión. Se propaga
      // para que quede en el log en vez de desaparecer.
      throw error;
    }
  }

  private async liberar(userId: string, clave: string): Promise<void> {
    try {
      await this.repo.delete({ userId, key: clave, status: 'IN_PROGRESS' });
    } catch {
      /* si no se pudo, la fila caduca sola por TTL */
    }
  }
}
