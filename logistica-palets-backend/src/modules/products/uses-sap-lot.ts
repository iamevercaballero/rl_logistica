import { EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';

/**
 * Regla de Lote SAP por material (`Product.usesSapLot`).
 *
 * `sapLot` es un dato **complementario** del lote: la identidad operativa sigue
 * siendo `lotCode`, y FEFO, vencimiento, fabricación, pallets, pilas, stock y
 * trazabilidad no dependen de esto. Lo único que cambia el flag es si el
 * sistema puede **escribir** un lote SAP nuevo para ese material.
 *
 * Dos comportamientos distintos según de dónde venga el valor:
 *
 *  - **Automático** (entrada, corrección, import de carga inicial): el lote SAP
 *    llega como un valor de cabecera que se aplica a todos los ítems. Ahí se
 *    descarta en silencio para el material que no lo usa — `dropSapLotIfUnused`.
 *    Cortar la operación sería peor: una entrada multi-producto legítima, con
 *    algunos materiales SAP y otros no, fallaría entera.
 *  - **Explícito** (alta/edición de un lote puntual desde Lotes): el usuario
 *    escribió ese valor en el campo de ese lote, así que se rechaza con un
 *    mensaje — `assertSapLotAllowed`. Ignorarlo en silencio dejaría un formulario
 *    que "guarda bien" y no guarda nada.
 *
 * En ningún caso se toca un `sapLot` ya guardado: apagar el flag es
 * configuración para operaciones futuras, no una limpieza retroactiva.
 */

/** `false` solo si el material está configurado explícitamente como no-SAP. */
export async function productUsesSapLot(manager: EntityManager, productId: string): Promise<boolean> {
  const product = await manager.getRepository(Product).findOne({
    where: { id: productId },
    select: { id: true, usesSapLot: true },
  });
  // Producto inexistente: no es acá donde se resuelve ese error. Se deja pasar
  // para que falle donde corresponde, con el mensaje de siempre.
  return product?.usesSapLot ?? true;
}

/**
 * Devuelve el lote SAP a guardar: `undefined` si el material no lo usa.
 * Solo consulta el material cuando hay un valor que descartar.
 */
export async function dropSapLotIfUnused(
  manager: EntityManager,
  productId: string,
  sapLot?: string | null,
): Promise<string | undefined> {
  if (!sapLot) return undefined;
  return (await productUsesSapLot(manager, productId)) ? sapLot : undefined;
}

/** Mensaje único del rechazo explícito, para que se lea igual en toda la app. */
export function sapLotNotAllowedMessage(productCode?: string): string {
  const material = productCode ? `El material ${productCode}` : 'Este material';
  return `${material} está configurado como "no utiliza Lote SAP": no se puede asignarle un lote SAP. Cambiá la configuración del material si corresponde.`;
}
