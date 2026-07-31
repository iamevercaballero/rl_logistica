import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dos cambios que habilitan la carga inicial de inventario desde el Excel del
 * cliente sin perder información:
 *
 *  1. Cantidades decimales. El inventario real se mide en unidades fraccionarias
 *     (TS, KG, HL: 42.84 TS, 2117.2 KG). Con columnas `integer` esas cantidades
 *     se redondean y el stock deja de cuadrar contra la planilla del cliente.
 *     Se migran a `numeric(14,3)` todas las columnas que participan de la
 *     aritmética del inventario: el stock por celda, el stock por lote, la
 *     cantidad por palet, la cantidad de cada movimiento y de su detalle, y los
 *     totales agregados de documentos y solicitudes de ajuste.
 *
 *     `sap_stock_snapshots.sapQuantity` también, porque se compara contra el
 *     stock del sistema: dejarla en `integer` haría aparecer diferencias
 *     inexistentes en cuanto el stock real tenga decimales.
 *
 *     La conversión integer → numeric es ampliatoria (ningún valor existente
 *     pierde precisión), así que no requiere limpieza previa de datos.
 *
 *  2. `lots.supplierLot` — código de lote del proveedor. La unicidad del lote es
 *     (producto, lote interno) y vive en `lotCode` (ya con índice único
 *     `uq_lot_product_code`); el lote del proveedor es un dato de trazabilidad
 *     que puede repetirse entre lotes internos distintos, así que necesita su
 *     propia columna y NO debe usarse para agrupar ni deduplicar.
 */
export class DecimalQuantitiesAndSupplierLot1782950000000 implements MigrationInterface {
  name = 'DecimalQuantitiesAndSupplierLot1782950000000';

  /** [tabla, columna, nullable, default] de cada cantidad del inventario. */
  private static readonly QUANTITY_COLUMNS: ReadonlyArray<[string, string, boolean, string | null]> = [
    ['stocks', 'currentQuantity', false, '0'],
    ['lots', 'stockActual', false, '0'],
    ['pallets', 'quantity', false, null],
    ['movements', 'quantity', false, null],
    ['movement_details', 'quantity', false, null],
    ['logistics_documents', 'totalQuantity', false, '0'],
    ['adjustment_requests', 'totalQuantity', false, '0'],
    ['adjustment_request_lines', 'totalQuantity', false, '0'],
    ['sap_stock_snapshots', 'sapQuantity', false, null],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column, , defaultValue] of DecimalQuantitiesAndSupplierLot1782950000000.QUANTITY_COLUMNS) {
      // El DEFAULT se descarta y se vuelve a poner: Postgres no puede castear
      // un default `integer` a `numeric` durante el ALTER TYPE.
      if (defaultValue !== null) {
        await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
      }
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE numeric(14,3) USING "${column}"::numeric(14,3)`,
      );
      if (defaultValue !== null) {
        await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${defaultValue}`);
      }
    }

    await queryRunner.query(`ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "supplierLot" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lots" DROP COLUMN IF EXISTS "supplierLot"`);

    // Vuelta a integer: redondea cualquier decimal cargado mientras la columna
    // era numeric. Es destructivo por naturaleza — de ahí que el rollback sólo
    // tenga sentido si todavía no se cargaron cantidades fraccionarias.
    for (const [table, column, , defaultValue] of DecimalQuantitiesAndSupplierLot1782950000000.QUANTITY_COLUMNS) {
      if (defaultValue !== null) {
        await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
      }
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE integer USING ROUND("${column}")::integer`,
      );
      if (defaultValue !== null) {
        await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT ${defaultValue}`);
      }
    }
  }
}
