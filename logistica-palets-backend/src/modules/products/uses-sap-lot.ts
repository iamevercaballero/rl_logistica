import { EntityManager } from 'typeorm';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { Product } from './entities/product.entity';

/**
 * Regla de Lote SAP: por depósito (`Warehouse.usesSapLot`) y por material
 * (`Product.usesSapLot`).
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
 *
 * La configuración vive en dos niveles y se combina con un AND: el lote SAP se
 * usa cuando el **depósito** (`Warehouse.usesSapLot`) y el **material**
 * (`Product.usesSapLot`) lo usan. Un depósito que no maneja el concepto lo
 * apaga de una vez para todos sus materiales, sin tocar el catálogo — que es
 * compartido entre depósitos.
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
 * `false` solo si el depósito está configurado explícitamente como no-SAP.
 * Sin depósito resuelto (movimiento que todavía no lo derivó) se asume que sí:
 * el nivel que decide en ese caso es el material.
 */
export async function warehouseUsesSapLot(
  manager: EntityManager,
  warehouseId?: string | null,
): Promise<boolean> {
  if (!warehouseId) return true;
  const warehouse = await manager.getRepository(Warehouse).findOne({
    where: { id: warehouseId },
    select: { id: true, usesSapLot: true },
  });
  return warehouse?.usesSapLot ?? true;
}

/**
 * Devuelve el lote SAP a guardar: `undefined` si el depósito o el material no
 * lo usan. Solo consulta la configuración cuando hay un valor que descartar.
 */
export async function dropSapLotIfUnused(
  manager: EntityManager,
  productId: string,
  sapLot?: string | null,
  warehouseId?: string | null,
): Promise<string | undefined> {
  if (!sapLot) return undefined;
  if (!(await warehouseUsesSapLot(manager, warehouseId))) return undefined;
  return (await productUsesSapLot(manager, productId)) ? sapLot : undefined;
}

/** Mensaje único del rechazo explícito, para que se lea igual en toda la app. */
export function sapLotNotAllowedMessage(productCode?: string): string {
  const material = productCode ? `El material ${productCode}` : 'Este material';
  return `${material} está configurado como "no utiliza Lote SAP": no se puede asignarle un lote SAP. Cambiá la configuración del material si corresponde.`;
}
