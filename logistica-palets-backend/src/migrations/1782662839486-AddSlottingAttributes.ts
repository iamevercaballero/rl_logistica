import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSlottingAttributes1782662839486 implements MigrationInterface {
    name = 'AddSlottingAttributes1782662839486'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // NOTA: se removió el `DROP INDEX uq_stock_cell` espurio que genera TypeORM
        // (índice de expresión no declarable en entidad — ver MIGRATIONS.md).
        await queryRunner.query(`ALTER TABLE "locations" ADD "temperatureZone" character varying(20) NOT NULL DEFAULT 'AMBIENT'`);
        await queryRunner.query(`ALTER TABLE "locations" ADD "maxWeightKg" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "locations" ADD "maxHeightCm" integer`);
        await queryRunner.query(`ALTER TABLE "locations" ADD "allowsStacking" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "products" ADD "weightKg" numeric(10,2)`);
        await queryRunner.query(`ALTER TABLE "products" ADD "heightCm" integer`);
        await queryRunner.query(`ALTER TABLE "products" ADD "fragile" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "products" ADD "temperatureZone" character varying(20) NOT NULL DEFAULT 'AMBIENT'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "rotationPolicy" character varying(10) NOT NULL DEFAULT 'FEFO'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "compatibilityGroup" character varying(40)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "compatibilityGroup"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "rotationPolicy"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "temperatureZone"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "fragile"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "heightCm"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "weightKg"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "allowsStacking"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "maxHeightCm"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "maxWeightKg"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP COLUMN "temperatureZone"`);
        // (sin recrear uq_stock_cell: nunca se dropeó en up())
    }

}
