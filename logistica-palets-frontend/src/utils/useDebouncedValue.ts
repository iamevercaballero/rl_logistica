import { useEffect, useState } from "react";

/** Lo que se siente instantáneo sin disparar una búsqueda por cada tecla. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * El valor, pero recién cuando dejó de cambiar por `delay` milisegundos.
 *
 * Es lo que permite que un buscador filtre solo mientras se escribe sin pedirle
 * al servidor una consulta por tecla: con 2.100 materiales eso era una ráfaga
 * de pedidos y una tabla que saltaba mientras el operador tipeaba.
 *
 * Al desmontar o al cambiar el valor se cancela el pendiente, así que nunca
 * llega un resultado viejo después de uno nuevo.
 */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  const [retrasado, setRetrasado] = useState(value);

  useEffect(() => {
    if (value === retrasado) return;
    const t = setTimeout(() => setRetrasado(value), delay);
    return () => clearTimeout(t);
    // `retrasado` no va como dependencia a propósito: si fuera, cada vez que se
    // aplica el valor el efecto volvería a correr y agendaría otro timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay]);

  return retrasado;
}
