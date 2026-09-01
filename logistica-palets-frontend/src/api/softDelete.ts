/**
 * Respuesta de las bajas que preservan la trazabilidad.
 *
 * Materiales, Lotes, Ubicaciones y Depósitos siguen el mismo criterio: con
 * historial no se borran, se desactivan. El backend lo informa con
 * `deactivated` y explica por qué en `reason`. Sin mirar ese campo la pantalla
 * diría "eliminado" mientras el registro sigue en la lista, y el usuario pensaría
 * que la operación falló.
 */
export type SoftDeleteResult = {
  deleted: boolean;
  deactivated: boolean;
  id: string;
  reason?: string;
};

/**
 * Mensaje para el aviso, según lo que realmente pasó.
 *
 * `singular` es el nombre de la entidad tal como lo lee el operador
 * ("Material", "Lote", "Ubicación", "Depósito").
 */
export function softDeleteMessage(res: SoftDeleteResult, singular: string): string {
  return res.deactivated
    ? `${singular} desactivado. Se conserva porque tiene movimientos registrados.`
    : `${singular} eliminado`;
}
