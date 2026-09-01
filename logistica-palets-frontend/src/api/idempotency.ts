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
