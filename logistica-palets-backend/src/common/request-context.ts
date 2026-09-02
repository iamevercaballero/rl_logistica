import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { clientIp, requestId, userAgent, type ProxyRequest } from './client-ip';

/**
 * Identidad de red de la petición en curso, accesible desde cualquier punto de
 * la pila sin pasarla por parámetro.
 *
 * El problema concreto: la bitácora de negocio (`document_events`) se escribe
 * desde catorce lugares, casi todos dentro de una transacción, en servicios que
 * no tienen —ni deberían tener— acceso al objeto `Request`. RL-M-09 dejó IP,
 * user-agent e id de correlación en `auth_events`, pero la bitácora de negocio
 * quedó sin ellos: se sabía quién hizo cada movimiento, no desde dónde.
 *
 * Hacerlo pasando los tres valores por parámetro habría exigido tocar los
 * catorce puntos de llamada y todas las firmas intermedias, con el riesgo de
 * migrar el camino de auditoría a medias: una llamada olvidada no falla, sólo
 * escribe una fila incompleta y nadie se entera. `AsyncLocalStorage` mantiene el
 * contexto atado a la petición a través de todo el árbol de `await`, así que el
 * dato llega solo y ningún punto de llamada cambia.
 *
 * Es de Node, no una dependencia nueva.
 */

export type ContextoDePeticion = {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

const VACIO: ContextoDePeticion = { ip: null, userAgent: null, requestId: null };

const almacen = new AsyncLocalStorage<ContextoDePeticion>();

/**
 * Contexto de la petición en curso.
 *
 * Devuelve nulos fuera de una petición HTTP —un cron, el seed, el arranque— y
 * eso es correcto: esas escrituras no vienen de nadie por la red, y una IP
 * inventada sería peor que ninguna. Por eso las tres columnas son nulables.
 */
export function contextoActual(): ContextoDePeticion {
  return almacen.getStore() ?? VACIO;
}

/** Ejecuta `fn` con el contexto derivado de `req`. Lo usan el middleware y los tests. */
export function conContextoDePeticion<T>(req: ProxyRequest | undefined, fn: () => T): T {
  return almacen.run(
    { ip: clientIp(req), userAgent: userAgent(req), requestId: requestId(req) },
    fn,
  );
}

/**
 * Siembra el contexto al principio de cada petición.
 *
 * Va como middleware y no como interceptor a propósito: el middleware corre
 * antes que guards, pipes e interceptores, así que el contexto ya está puesto
 * incluso para las peticiones que terminan rechazadas — que son justamente las
 * que interesa poder atribuir.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: ProxyRequest, _res: unknown, next: () => void) {
    conContextoDePeticion(req, next);
  }
}
