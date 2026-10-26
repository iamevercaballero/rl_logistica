import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Documento Material por lote dentro de una Salida.
 *
 * Hasta acá el dato vivía sólo en la cabecera del remito y en el movimiento, y
 * un movimiento es un producto entero: todos los lotes de ese producto
 * compartían documento por construcción. En el depósito no siempre es así —dos
 * lotes del mismo material pueden salir contra documentos distintos— y la
 * pantalla obligaba a cargar uno solo para todo el remito.
 *
 * El detalle del movimiento ya existe palet por palet y conoce su lote, así que
 * es el lugar natural: no hay que partir el remito en un movimiento por lote, y
 * el Historial y los remitos ya emitidos siguen viéndose igual.
 *
 * El relleno copia el documento del movimiento a su propio detalle, de modo que
 * todo lo cargado hasta hoy quede idéntico pero expresado en el nuevo lugar.
 */
export class AddDocumentoMaterialPorLote1785400000000 implements MigrationInterface {
  name = 'AddDocumentoMaterialPorLote1785400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "movement_details" ADD COLUMN IF NOT EXISTS "documentoMaterial" character varying(80)`,
    );

    // Histórico: cada detalle hereda el documento de su movimiento.
    await queryRunner.query(`
      UPDATE "movement_details" d
      SET "documentoMaterial" = m."documentoMaterial"
      FROM "movements" m
      WHERE d."movementId" = m.id
        AND m."type" = 'EXIT'
        AND NULLIF(BTRIM(m."documentoMaterial"), '') IS NOT NULL
        AND d."documentoMaterial" IS NULL
    `);

    // El filtro "Pendiente de documento material" de Salidas pasa a mirar el
    // detalle: alcanza con que UN lote no lo tenga para que el movimiento
    // cuente como pendiente.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_movement_detail_sin_documento_material"
      ON "movement_details" ("movementId")
      WHERE NULLIF(BTRIM("documentoMaterial"), '') IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_movement_detail_sin_documento_material"`);
    await queryRunner.query(`ALTER TABLE "movement_details" DROP COLUMN IF EXISTS "documentoMaterial"`);
  }
}
