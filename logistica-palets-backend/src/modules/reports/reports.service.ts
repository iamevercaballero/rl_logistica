import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  stock() {
    return this.dataSource.query('SELECT * FROM vw_stock_actual');
  }

  movements() {
    return this.dataSource.query('SELECT * FROM vw_movements_detail');
  }

  trace(palletId: string) {
    return this.dataSource.query(
      'SELECT * FROM vw_pallet_trace WHERE pallet_id = $1',
      [palletId],
    );
  }
    async kpis() {
    const [row] = await this.dataSource.query(`
      SELECT
        (SELECT COUNT(*)::int FROM pallets) AS total_pallets,
        COALESCE((SELECT SUM(quantity)::int FROM pallets), 0) AS total_units,
        (SELECT COUNT(*)::int FROM movements WHERE date::date = CURRENT_DATE) AS movements_today
    `);

    const stockByWarehouse = await this.dataSource.query(`
      SELECT
        w.id,
        w.name,
        COALESCE(SUM(p.quantity), 0)::int AS total_units,
        COUNT(p.*)::int AS total_pallets
      FROM warehouses w
      LEFT JOIN locations l ON l."warehouseId" = w.id
      LEFT JOIN pallets p ON p."currentLocationId" = l.id
      GROUP BY w.id, w.name
      ORDER BY w.name ASC
    `);


    return {
      totalPallets: row.total_pallets,
      totalUnits: row.total_units,
      movementsToday: row.movements_today,
      stockByWarehouse,
    };
  }

}
