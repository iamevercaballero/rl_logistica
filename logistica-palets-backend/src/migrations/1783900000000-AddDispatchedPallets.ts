import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `movement_details.dispatchedPallets` — paletas físicas resultantes por palet
 * de origen en una Salida.
 *
 * Nullable y sin default: `null` significa "no se informó", que es el caso
 * normal y el estado en que quedan todas las salidas históricas. No participa
 * del motor de stock — el descuento de stock, lotes y palets de origen sigue
 * siendo exactamente el mismo, este número solo describe cómo se preparó la
 * carga físicamente.
 */
export class AddDispatchedPallets1783900000000 implements MigrationInterface {
  name = 'AddDispatchedPallets1783900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "movement_details" ADD COLUMN IF NOT EXISTS "dispatchedPallets" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "movement_details" DROP COLUMN IF EXISTS "dispatchedPallets"`);
  }
}
