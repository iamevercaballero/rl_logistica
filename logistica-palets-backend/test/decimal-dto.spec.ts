import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMovementDto, PalletItemDto } from '../src/modules/movements/dto/create-movement.dto';
import { TransferBatchDto } from '../src/modules/movements/dto/transfer-batch.dto';
import { UpsertSapStockDto } from '../src/modules/reports/dto/upsert-sap-stock.dto';

/**
 * Verifica que `@NormalizeDecimal()` en los DTOs acepte la cantidad tal como la
 * manda el frontend — string con coma o punto — igual que lo haría la
 * `ValidationPipe` global de `main.ts` (`transform: true`).
 */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PALLET_ID = '22222222-2222-4222-8222-222222222222';
const LOC_FROM = '33333333-3333-4333-8333-333333333333';
const LOC_TO = '44444444-4444-4444-8444-444444444444';

async function firstError(dto: object) {
  const errors = await validate(dto);
  return errors.length === 0 ? null : errors;
}

describe('PalletItemDto — cantidad decimal desde el frontend', () => {
  const build = (quantity: unknown) =>
    plainToInstance(PalletItemDto, { lotCode: 'L1', quantity });

  it('acepta "3537,37" (coma) y lo deja como número', async () => {
    const dto = build('3537,37');
    expect(dto.quantity).toBe(3537.37);
    expect(await firstError(dto)).toBeNull();
  });

  it('acepta "3537.37" (punto) igual que la coma', async () => {
    const dto = build('3537.37');
    expect(dto.quantity).toBe(3537.37);
    expect(await firstError(dto)).toBeNull();
  });

  it('acepta el número directo', async () => {
    const dto = build(3537.37);
    expect(dto.quantity).toBe(3537.37);
    expect(await firstError(dto)).toBeNull();
  });

  for (const value of ['0,25', '1,50', '999999,999']) {
    it(`acepta ${value}`, async () => {
      expect(await firstError(build(value))).toBeNull();
    });
  }

  it('rechaza más de 3 decimales', async () => {
    expect(await firstError(build('3537,3714'))).not.toBeNull();
  });

  it('rechaza 0 y negativos', async () => {
    expect(await firstError(build('0'))).not.toBeNull();
    expect(await firstError(build('-5'))).not.toBeNull();
  });

  it('deja el string sin parsear como inválido (no lo convierte en NaN silencioso)', async () => {
    const dto = build('abc');
    expect(dto.quantity).toBe('abc');
    expect(await firstError(dto)).not.toBeNull();
  });
});

describe('CreateMovementDto — quantity de cabecera', () => {
  it('normaliza "1.234,5" (miles + coma decimal) a 1234.5', async () => {
    const dto = plainToInstance(CreateMovementDto, {
      type: 'EXIT',
      productId: PRODUCT_ID,
      quantity: '1.234,5',
    });
    expect(dto.quantity).toBe(1234.5);
    expect(await firstError(dto)).toBeNull();
  });
});

describe('TransferBatchDto — cantidad por palet decimal', () => {
  it('acepta "1,5" en el ítem de transferencia', async () => {
    const dto = plainToInstance(TransferBatchDto, {
      fromLocationId: LOC_FROM,
      toLocationId: LOC_TO,
      lines: [{ productId: PRODUCT_ID, palletItems: [{ palletId: PALLET_ID, quantity: '1,5' }] }],
    });
    expect(dto.lines[0].palletItems[0].quantity).toBe(1.5);
    expect(await firstError(dto)).toBeNull();
  });
});

describe('UpsertSapStockDto — sapQuantity decimal', () => {
  it('acepta "42,84" para el stock informado por SAP', async () => {
    const dto = plainToInstance(UpsertSapStockDto, {
      date: '2026-08-28',
      productId: PRODUCT_ID,
      sapQuantity: '42,84',
    });
    expect(dto.sapQuantity).toBe(42.84);
    expect(await firstError(dto)).toBeNull();
  });
});
