import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  addConstraintIfMissing,
  INVENTORY_CHECKS,
  INVENTORY_FKS,
  inventoryFkName,
} from '../common/inventory-constraints';

/**
 * RL-C-03 — integridad referencial del inventario.
 *
 * Hasta acá la base tenía 6 claves foráneas en 29 tablas y una sola restricción
 * CHECK (una expresión regular sobre un código de documento). `movements`,
 * `stocks`, `pallets` y `movement_details` no tenían ninguna: `productId`,
 * `lotId`, `palletId`, `locationId` y `warehouseId` eran columnas `uuid` sueltas.
 *
 * O sea que la integridad del inventario vivía **sólo en el código**. Cualquier
 * escritura que no pasara por la API —un script de mantenimiento, una corrección
 * por psql, una restauración parcial— podía dejar movimientos apuntando a
 * productos inexistentes, y nada lo detectaba. Para un sistema que tiene que
 * reconstruir la historia de un lote diez años después, eso es la diferencia
 * entre un invariante y una casualidad.
 *
 * ── Criterio de ON DELETE ──────────────────────────────────────────────────
 * `RESTRICT` para todo lo que es historia: un producto, lote, ubicación o
 * depósito con movimientos registrados no se borra, se desactiva. Es el patrón
 * que ya seguían `products.remove`, `warehouses.remove` y `lots.remove`; ahora
 * la base lo respalda en vez de confiar en que el servicio se acuerde.
 *
 * `CASCADE` sólo donde la fila hija no tiene vida propia: el detalle de un
 * movimiento, las líneas de una solicitud de ajuste, y los permisos de un
 * usuario (mismo criterio que `user_warehouses`, que ya venía así).
 *
 * ── Lo que deliberadamente NO lleva clave foránea ──────────────────────────
 * Las columnas de autoría (`createdById`, `approvedById`, `changedById`,
 * `encargadoId`, `encargadoRecepcionId`, `actorUserId`, `targetUserId`). Es una
 * decisión ya tomada y documentada en `user-audit-log.entity.ts`: un actor dado
 * de baja no debe romper ni vaciar el historial de lo que hizo. Hoy además los
 * usuarios son baja lógica, así que el riesgo es teórico por partida doble.
 *
 * Y las columnas polimórficas `attachments.entityId` y `document_events.entityId`,
 * que apuntan a una tabla distinta según `entityType`: no hay clave foránea
 * posible sin partirlas en una columna por tipo.
 *
 * ── Seguridad de la migración ──────────────────────────────────────────────
 * Aborta con un mensaje que dice qué limpiar si encuentra filas huérfanas o
 * cantidades fuera de rango, en vez de fallar a mitad de camino con un error de
 * Postgres. Mismo criterio que `HardenInventoryIntegrity`. Para saber de
 * antemano si va a pasar, correr `scripts/check-referential-integrity.sql`
 * contra la base — es de sólo lectura y sirve sobre producción en marcha.
 */
export class AddInventoryForeignKeys1784600000000 implements MigrationInterface {
  name = 'AddInventoryForeignKeys1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Esta migración se exime del `statement_timeout` que la aplicación fija en
    // la conexión (ver src/config/db-limits.ts). No es un caso hipotético:
    // validar 44 claves foráneas obliga a PostgreSQL a recorrer cada tabla una
    // vez, y sobre un volumen de producción eso puede pasarse de los 30 segundos
    // que acotan una consulta de negocio. `SET LOCAL` vale sólo dentro de la
    // transacción de la migración, así que no afecta a nada más.
    await queryRunner.query(`SET LOCAL statement_timeout = 0`);

    // ── 1. Verificar antes de tocar nada ──────────────────────────────────────
    const problemas: string[] = [];

    for (const [tabla, columna, destino] of INVENTORY_FKS) {
      const [{ n }] = (await queryRunner.query(
        `SELECT COUNT(*)::int AS n FROM "${tabla}" x
          WHERE x."${columna}" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "${destino}" t WHERE t.id = x."${columna}")`,
      )) as Array<{ n: number }>;
      if (n > 0) {
        problemas.push(`${tabla}.${columna} → ${destino}: ${n} fila(s) apuntan a un registro inexistente`);
      }
    }

    for (const [tabla, nombre, expresion] of INVENTORY_CHECKS) {
      const [{ n }] = (await queryRunner.query(
        `SELECT COUNT(*)::int AS n FROM "${tabla}" WHERE NOT (${expresion})`,
      )) as Array<{ n: number }>;
      if (n > 0) {
        problemas.push(`${tabla}: ${n} fila(s) violan ${nombre} (${expresion})`);
      }
    }

    if (problemas.length > 0) {
      throw new Error(
        `No se pueden crear las restricciones de integridad: la base tiene ${problemas.length} ` +
          `problema(s) que hay que resolver primero.\n  • ${problemas.join('\n  • ')}\n\n` +
          `Corré scripts/check-referential-integrity.sql para el detalle completo. ` +
          `Consolidá o corregí esas filas y volvé a intentar — la migración no las toca ` +
          `por su cuenta: decidir qué hacer con un movimiento cuyo producto ya no existe ` +
          `es una decisión de negocio, no de esquema.`,
      );
    }

    // ── 2. Claves foráneas ────────────────────────────────────────────────────
    for (const [tabla, columna, destino, accion] of INVENTORY_FKS) {
      const nombre = inventoryFkName(tabla, columna);
      // ADD CONSTRAINT no admite IF NOT EXISTS: se consulta el catálogo para que
      // re-aplicar la migración sobre una base a medias no explote.
      await queryRunner.query(
        addConstraintIfMissing(
          tabla, nombre,
          `FOREIGN KEY ("${columna}") REFERENCES "${destino}"("id") ON DELETE ${accion} ON UPDATE NO ACTION`,
        ),
      );
    }

    // Deliberadamente NO se crea un índice por cada clave foránea. Serían 39
    // índices nuevos, 13 sobre `movements`, que es la tabla de mayor crecimiento
    // y la que más se escribe. El índice del lado que referencia sólo lo usa el
    // chequeo de un DELETE en la tabla destino, y ese caso es raro (borrar un
    // producto o una ubicación) y encima corta apenas encuentra la primera fila
    // que lo referencia. Pagar el costo de escritura de 39 índices para acelerar
    // una operación excepcional no se justifica; los índices que sí hacen falta
    // son los del listado de movimientos, que van aparte con su propia medición.

    // ── 3. Restricciones de rango ─────────────────────────────────────────────
    for (const [tabla, nombre, expresion] of INVENTORY_CHECKS) {
      await queryRunner.query(addConstraintIfMissing(tabla, nombre, `CHECK (${expresion})`));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [tabla, nombre] of INVENTORY_CHECKS) {
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP CONSTRAINT IF EXISTS "${nombre}"`);
    }
    for (const [tabla, columna] of INVENTORY_FKS) {
      const nombre = inventoryFkName(tabla, columna);
      await queryRunner.query(`ALTER TABLE "${tabla}" DROP CONSTRAINT IF EXISTS "${nombre}"`);
    }
  }
}
