import { useCallback, useRef } from "react";

/**
 * Clave de idempotencia para las escrituras que crean algo (RL-A-01).
 *
 * El backend deduplica por esta cabecera: si llegan dos peticiones con la misma
 * clave, la segunda recibe la respuesta de la primera en vez de crear otro
 * movimiento.
 *
 * Lo importante es CUÁNDO se genera. Si se generara en cada envío, un doble clic
 * mandaría dos claves distintas y crearía dos movimientos igual — que es
 * exactamente el problema que hay que resolver. Por eso la clave se ata al
 * formulario, no al clic: nace con el formulario, sobrevive a todos los reintentos
 * de esa misma carga, y se renueva recién cuando la operación salió bien y el
 * operador empieza una carga nueva.
 *
 * El reintento del interceptor de axios tras refrescar el token queda cubierto
 * solo: reenvía la petición original con sus cabeceras.
 */
export function nuevaClaveIdempotencia(): string {
  // `randomUUID` necesita contexto seguro; en http:// plano no existe.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Cabecera lista para pasarle a axios. */
export function cabeceraIdempotencia(clave: string | undefined) {
  return clave ? { headers: { "Idempotency-Key": clave } } : undefined;
}

/**
 * Clave para UNA de las operaciones de un envío que manda varias.
 *
 * Se deriva del CONTENIDO de esa operación, no de su posición en el envío.
 * Numerarlas (`base-0`, `base-1`, …) parece equivalente y no lo es: si una sale
 * bien y otra falla, la que salió bien se saca del carrito, las que quedan se
 * recorren de nuevo desde cero y la que antes era la 1 pasa a ser la 0 — o sea,
 * reusa la clave de una operación distinta que YA se completó. El backend lo
 * rechaza, con razón, y el operador ve "La clave de idempotencia ya se usó para
 * otra operación" sin haber hecho nada raro.
 *
 * Derivándola del contenido las dos propiedades se sostienen solas: el mismo
 * contenido da la misma clave (doble clic y reintentos siguen deduplicados) y
 * un contenido distinto da una clave distinta (nunca choca con otra operación).
 */
export function claveDerivada(base: string, contenido: unknown): string {
  return `${base}-${huella(JSON.stringify(contenido) ?? "")}`;
}

/**
 * FNV-1a de 32 bits en hexadecimal.
 *
 * Alcanza y sobra: esto no protege nada, sólo distingue operaciones dentro de
 * un mismo envío —son unas pocas— y la clave ya viene namespaceada por `base`,
 * que es un UUID. No se usa `crypto.subtle` porque es asíncrono y pide contexto
 * seguro, que en http:// plano no hay.
 */
function huella(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Mantiene una clave estable mientras dure la carga en curso.
 *
 * `renovar()` va DESPUÉS de un envío exitoso: a partir de ahí, lo que el
 * operador cargue es una operación nueva y merece una clave nueva.
 */
export function useClaveIdempotencia(): { clave: () => string; renovar: () => void } {
  const ref = useRef<string | null>(null);

  const clave = useCallback(() => {
    if (!ref.current) ref.current = nuevaClaveIdempotencia();
    return ref.current;
  }, []);

  const renovar = useCallback(() => {
    ref.current = null;
  }, []);

  return { clave, renovar };
}
