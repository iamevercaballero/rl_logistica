/**
 * Carga única del layout real del depósito (zonas A/B/C/D), reutilizando el
 * generador de ubicaciones YA existente (LocationsService.generate / POST
 * /locations/generate) — sin lógica nueva, solo lo llama una vez por cada
 * grupo homogéneo de la planilla del cliente. "racks" = filas del sector.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/setup-real-locations.ts            (vista previa)
 *   npx ts-node --transpile-only scripts/setup-real-locations.ts --commit   (aplica)
 */
import { AppDataSource } from '../src/data-source';
import { Warehouse } from '../src/modules/warehouses/entities/warehouse.entity';
import { Location } from '../src/modules/locations/entities/location.entity';
import { Pallet } from '../src/modules/pallets/entities/pallet.entity';
import { Product } from '../src/modules/products/entities/product.entity';
import { LocationsService } from '../src/modules/locations/locations.service';
import { GenerateLocationsDto } from '../src/modules/locations/dto/generate-locations.dto';

type Call = Omit<GenerateLocationsDto, 'warehouseId' | 'zone'>;

// racks = filas del sector; levels = niveles reales (1 si es piso); positions = capacidad por fila/nivel.
const CALLS: Call[] = [
  { aisles: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], racks: 2, levels: 1, positions: 15, capacityPallets: 1 },
  { aisles: ['A7'], racks: 1, levels: 1, positions: 15, capacityPallets: 1 },
  { aisles: ['B1', 'B2', 'B3'], racks: 2, levels: 1, positions: 8, capacityPallets: 1 },
  { aisles: ['B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11', 'B12', 'B13'], racks: 2, levels: 1, positions: 13, capacityPallets: 1 },
  { aisles: ['B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21'], racks: 1, levels: 3, positions: 13, capacityPallets: 1 },
  { aisles: ['B22'], racks: 1, levels: 1, positions: 13, capacityPallets: 1 },
  { aisles: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], racks: 2, levels: 1, positions: 8, capacityPallets: 1 },
  { aisles: ['C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17'], racks: 2, levels: 1, positions: 13, capacityPallets: 1 },
  { aisles: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'], racks: 2, levels: 1, positions: 8, capacityPallets: 1 },
  { aisles: ['D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16'], racks: 2, levels: 1, positions: 13, capacityPallets: 1 },
];

const ZONE = 'ALMACENAMIENTO';

function countFor(c: Call): number {
  return (c.aisles?.length ?? 1) * (c.racks ?? 1) * (c.levels ?? 1) * c.positions;
}

async function main() {
  const commit = process.argv.includes('--commit');
  const total = CALLS.reduce((s, c) => s + countFor(c), 0);

  console.log(`Plan: ${CALLS.length} llamadas al generador existente, ${total} ubicaciones en total.`);
  for (const c of CALLS) {
    console.log(`  ${c.aisles?.[0]}..${c.aisles?.[c.aisles.length - 1]}: racks=${c.racks} levels=${c.levels} positions=${c.positions} → ${countFor(c)}`);
  }

  if (!commit) {
    console.log('\nVista previa solamente (no se escribió nada). Correr con --commit para aplicar.');
    return;
  }

  await AppDataSource.initialize();
  try {
    const warehouseRepo = AppDataSource.getRepository(Warehouse);
    const warehouses = await warehouseRepo.find();
    if (warehouses.length !== 1) {
      console.error(`Se esperaba exactamente 1 depósito, se encontraron ${warehouses.length}. Abortando.`);
      console.error(warehouses.map((w) => ({ id: w.id, name: w.name })));
      return;
    }
    const warehouse = warehouses[0];
    console.log(`Depósito: ${warehouse.name} (${warehouse.id})`);

    const service = new LocationsService(
      AppDataSource.getRepository(Location),
      warehouseRepo,
      AppDataSource.getRepository(Pallet),
      AppDataSource.getRepository(Product),
    );

    let createdTotal = 0;
    let skippedTotal = 0;
    for (const c of CALLS) {
      const res = await service.generate({ ...c, warehouseId: warehouse.id, zone: ZONE });
      console.log(`  ${c.aisles?.[0]}..${c.aisles?.[c.aisles.length - 1]}: creadas ${res.created}, ya existían ${res.skipped}`);
      createdTotal += res.created;
      skippedTotal += res.skipped;
    }
    console.log(`\nListo. Creadas ${createdTotal}, ya existían ${skippedTotal}.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
