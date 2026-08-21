import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `warehouses.usesSapLot` — si el depósito opera con Lote SAP ("Lote Ypané").
 *
 * Ya existía la configuración por material (`products.usesSapLot`). Esto la
 * completa un nivel más arriba: hay depósitos que directamente no manejan el
 * concepto, y ahí no tiene sentido que cada material lo apague uno por uno.
 *
 * La regla es un AND: el lote SAP se usa cuando el depósito **y** el material
 * lo usan. Apagarlo en el depósito alcanza para que el campo desaparezca de la
 * entrada y de la etiqueta de pallet, sin tocar el catálogo de materiales.
 *
 * Nace en `true` para los depósitos existentes: hasta hoy todos manejaban lote
 * SAP, así que ese es el comportamiento a preservar. Como con el flag de
 * material, apagarlo es configuración de operaciones **futuras** — los
 * `lots.sapLot` ya guardados no se tocan.
 */
export class AddWarehouseUsesSapLot1784000000000 implements MigrationInterface {
  name = 'AddWarehouseUsesSapLot1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "usesSapLot" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN IF EXISTS "usesSapLot"`);
  }
}
