import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 1. Catálogo de proveedores. Hasta acá el proveedor era texto libre en cada
 *    remito, así que "Cervepar", "CERVEPAR" y "Cervepar S.A." eran tres
 *    proveedores distintos para cualquier reporte.
 *
 * 2. `transports.carrier` — la transportadora (empresa) del vehículo. Se
 *    tipeaba a mano en cada remito pudiendo salir de Transportes.
 *
 * 3. `logistics_documents.driverDocument` — la CI del conductor, para que
 *    salga impresa en la nota de entrada/entrega.
 *
 * El índice único de proveedores se crea sólo si los datos lo permiten: si ya
 * hubiera nombres repetidos, la migración aborta indicando qué limpiar en vez
 * de descartar filas en silencio.
 */
export class CreateSuppliersAndTransportCarrier1783200000000 implements MigrationInterface {
  name = 'CreateSuppliersAndTransportCarrier1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "ruc" character varying(20),
        "notes" text,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_suppliers_id" PRIMARY KEY ("id")
      )
    `);

    const duplicates = await queryRunner.query(`
      SELECT UPPER(TRIM(name)) AS n, COUNT(*)::int AS c
      FROM suppliers GROUP BY UPPER(TRIM(name)) HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      throw new Error(
        `No se puede crear uq_supplier_name: hay ${duplicates.length} nombre(s) de proveedor ` +
        `duplicados. Consolidalos antes de migrar.`,
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_supplier_name" ON "suppliers" ("name")`,
    );

    await queryRunner.query(`ALTER TABLE "transports" ADD COLUMN IF NOT EXISTS "carrier" character varying(160)`);
    await queryRunner.query(
      `ALTER TABLE "logistics_documents" ADD COLUMN IF NOT EXISTS "driverDocument" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "movements" ADD COLUMN IF NOT EXISTS "driverDocument" character varying(40)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "movements" DROP COLUMN IF EXISTS "driverDocument"`);
    await queryRunner.query(`ALTER TABLE "logistics_documents" DROP COLUMN IF EXISTS "driverDocument"`);
    await queryRunner.query(`ALTER TABLE "transports" DROP COLUMN IF EXISTS "carrier"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "suppliers"`);
  }
}
