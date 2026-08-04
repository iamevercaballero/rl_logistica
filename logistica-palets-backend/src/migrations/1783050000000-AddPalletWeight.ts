import { MigrationInterface, QueryRunner } from 'typeorm';

/** Peso físico del pallet (kg), cargado por lote en la entrada e impreso en la etiqueta. */
export class AddPalletWeight1783050000000 implements MigrationInterface {
  name = 'AddPalletWeight1783050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pallets" ADD COLUMN IF NOT EXISTS "weightKg" numeric(10,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pallets" DROP COLUMN IF EXISTS "weightKg"`);
  }
}
