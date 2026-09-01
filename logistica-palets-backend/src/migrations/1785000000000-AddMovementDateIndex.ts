import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice para la consulta de la pantalla de movimientos (RL-A-07).
 *
 * `movements` tenía índices sobre `createdAt`, `productId`, `(type, status)`,
 * `palletId`, `lotId` y `documentId`, pero ninguno sobre `date` — que es por
 * donde `findAll` ordena y filtra. Cada página hacía un recorrido completo de la
 * tabla y un ordenamiento externo para devolver 20 filas.
 *
 * **Medido**, no estimado: un millón de movimientos (diez años a ~275 por día,
 * el horizonte que plantea el pliego) y 800.000 líneas de detalle, sobre una
 * copia del esquema real.
 *
 *                                        antes      después
 *   página profunda (offset 10000)      110,1 ms     1,9 ms
 *   filtro por rango de 30 días          99,3 ms     0,1 ms
 *   alcance de OPERATOR (OR sobre 3      104,2 ms    0,1 ms
 *     columnas de depósito)
 *   COUNT de la paginación                47,9 ms   48,6 ms   (no lo toca)
 *
 * Sobre el alcance de OPERATOR: el informe original proponía un índice compuesto
 * `(warehouseId, date)`, pero el filtro real es
 * `warehouseId IN (...) OR fromWarehouseId IN (...) OR toWarehouseId IN (...)`,
 * un OR sobre tres columnas distintas que ningún índice compuesto puede servir
 * —PostgreSQL necesitaría un BitmapOr de tres índices, y eso pierde el orden y
 * fuerza el ordenamiento igual—. Con este índice el planificador recorre por
 * fecha y descarta al vuelo, y el LIMIT corta temprano: 0,1 ms. Un índice sobre
 * `warehouseId` no habría servido para nada acá.
 *
 * **Costo de escritura**: medido insertando 50.000 filas, +7 µs por fila
 * (2.448 ms contra 2.096 ms, ~17% en carga masiva). En la operación real —unos
 * cientos de movimientos por día, de a uno— es imperceptible.
 *
 * **Costo de almacenamiento**: 16 MB por cada 1,3 millones de filas, el mismo
 * tamaño que `idx_movement_product` y comparable a los otros siete índices que
 * la tabla ya tiene. Es un índice ordinario para esta tabla, no uno caro.
 *
 * El índice solo NO arregla la pantalla principal: su costo no es el orden sino
 * el agregado de lotes, que se corrigió en `movements.service.ts`. Los dos
 * cambios son complementarios y ninguno sirve sin el otro — con índice y sin la
 * corrección de la consulta, la pantalla seguía en 2.262 ms; con la corrección y
 * sin índice, 274 ms; con ambos, 0,9 ms.
 */
export class AddMovementDateIndex1785000000000 implements MigrationInterface {
  name = 'AddMovementDateIndex1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `CREATE INDEX` a secas y no `CONCURRENTLY`: construirlo sobre 1,3 millones
    // de filas tomó 665 ms en la medición, y la tabla en producción todavía es
    // chica. Si alguna vez hay que aplicarlo sobre una tabla ya grande, la
    // alternativa es crearlo a mano con `CREATE INDEX CONCURRENTLY` —fuera de
    // transacción— y después marcar esta migración como aplicada.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_movement_date_created" ON "movements" ("date", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_date_created"`);
  }
}
