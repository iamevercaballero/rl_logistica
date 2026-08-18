import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `products.usesSapLot` — si el material se maneja con Lote SAP ("Lote Ypané").
 *
 * Nace en `true` para todos los materiales existentes: hasta hoy el sistema
 * autocompletaba el lote SAP en cada entrada sin distinguir material, así que
 * ese es el comportamiento que hay que preservar. Apagarlo es una decisión
 * explícita por material, y aplica solo a operaciones futuras — los lotes SAP
 * ya guardados en `lots.sapLot` no se tocan acá ni al cambiar la configuración.
 */
export class AddProductUsesSapLot1783800000000 implements MigrationInterface {
  name = 'AddProductUsesSapLot1783800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "usesSapLot" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "usesSapLot"`);
  }
}
