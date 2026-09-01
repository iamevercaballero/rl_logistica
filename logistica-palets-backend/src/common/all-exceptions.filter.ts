import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestId } from './client-ip';

/**
 * Filtro global de excepciones (RL-M-14).
 *
 * El filtro por defecto de Nest no filtra stack traces al cliente, así que no
 * había exposición — pero tampoco había forma de normalizar los errores ni de
 * correlacionarlos con el log del servidor. Cuando un operador avisa que "algo
 * falló", no había ningún dato que pudiera dictar para encontrar qué pasó.
 *
 * Lo que hace:
 *
 *  · Agrega `requestId` a toda respuesta de error, el mismo id de correlación
 *    que viaja en la cabecera `X-Request-Id` (RL-M-09). Eso convierte "no anda"
 *    en una búsqueda de un segundo en el log.
 *  · Registra las excepciones no controladas con su stack, que antes se perdían
 *    en la salida por defecto sin contexto de la petición.
 *  · Responde un mensaje genérico ante un error no controlado, en vez de lo que
 *    haya quedado en `error.message` — que puede nombrar tablas, columnas o
 *    rutas del servidor.
 *
 * Lo que deliberadamente NO hace: cambiar la forma del cuerpo. El frontend lee
 * `data.message` y acepta tanto una cadena como el array que devuelve
 * class-validator; reescribir eso rompería todos los mensajes de la aplicación
 * en silencio. El filtro **agrega** campos, no reemplaza los que ya había.
 *
 * El versionado de API que menciona el mismo hallazgo queda afuera a propósito:
 * es una decisión de producto —cuántas versiones sostener y por cuánto tiempo—,
 * no un defecto que se corrija con un filtro.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlacion = requestId(req as never);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const cuerpo = exception.getResponse();

      // `getResponse()` devuelve una cadena cuando la excepción se construyó con
      // un mensaje suelto, y un objeto cuando lleva cuerpo propio (el caso de
      // class-validator, que manda `message` como array).
      const base = typeof cuerpo === 'string' ? { message: cuerpo } : (cuerpo as Record<string, unknown>);

      // Los 5xx que llegan como HttpException igual se registran: un 503 del
      // health check o un 500 explícito son cosas que hay que poder ver.
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`${req.method} ${req.url} → ${status}: ${exception.message}`, exception.stack);
      }

      res.status(status).json({ statusCode: status, ...base, requestId: correlacion });
      return;
    }

    // No controlada: acá es donde el stack importa y donde el mensaje no debe
    // salir. Se registra todo del lado del servidor y el cliente recibe el id
    // para poder referirse a este error concreto.
    this.logger.error(
      `${req.method} ${req.url} → excepción no controlada: ${
        exception instanceof Error ? exception.message : String(exception)
      }`,
      exception instanceof Error ? exception.stack : undefined,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Ocurrió un error inesperado. Si vuelve a pasar, pasale este código a soporte.',
      requestId: correlacion,
    });
  }
}
