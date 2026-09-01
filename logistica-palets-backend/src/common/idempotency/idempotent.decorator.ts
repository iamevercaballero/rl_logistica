import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marca un endpoint para que `IdempotencyInterceptor` lo proteja: si llega dos
 * veces la misma `Idempotency-Key` del mismo usuario, la segunda devuelve la
 * respuesta de la primera en vez de volver a ejecutar.
 *
 * Va sólo en escrituras que crean algo. En un PATCH que fija un valor concreto
 * repetir no duplica nada; el problema son las operaciones que suman.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
