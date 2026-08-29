import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDocumentDto } from '../src/modules/movements/dto/create-document.dto';

/**
 * El responsable ("encargado de recepción") es obligatorio en una entrada: la
 * `ValidationPipe` global lo rechaza si falta, en vez de que el servicio lo
 * complete con el usuario logueado.
 */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const ENCARGADO_ID = '22222222-2222-4222-8222-222222222222';
const LOC_ID = '33333333-3333-4333-8333-333333333333';

const line = () => ({
  productId: PRODUCT_ID,
  palletItems: [{ lotCode: 'L1', quantity: 10, fechaVencimiento: '2027-12-31', locationId: LOC_ID }],
});

async function errorsFor(payload: object) {
  return validate(plainToInstance(CreateDocumentDto, payload));
}

describe('CreateDocumentDto — encargadoId', () => {
  it('ENTRY sin encargadoId → inválido', async () => {
    const errors = await errorsFor({ type: 'ENTRY', lines: [line()] });
    expect(errors.some((e) => e.property === 'encargadoId')).toBe(true);
  });

  it('ENTRY con encargadoId UUID → válido', async () => {
    const errors = await errorsFor({ type: 'ENTRY', encargadoId: ENCARGADO_ID, lines: [line()] });
    expect(errors.some((e) => e.property === 'encargadoId')).toBe(false);
  });

  it('ENTRY con encargadoId que no es UUID → inválido', async () => {
    const errors = await errorsFor({ type: 'ENTRY', encargadoId: 'no-uuid', lines: [line()] });
    expect(errors.some((e) => e.property === 'encargadoId')).toBe(true);
  });

  it('EXIT sin encargadoId → válido (el "recibido por" de la salida lo firma el cliente)', async () => {
    const errors = await errorsFor({ type: 'EXIT', lines: [line()] });
    expect(errors.some((e) => e.property === 'encargadoId')).toBe(false);
  });

  it('EXIT con encargadoId que no es UUID → inválido igual (si se manda, se valida)', async () => {
    const errors = await errorsFor({ type: 'EXIT', encargadoId: 'no-uuid', lines: [line()] });
    expect(errors.some((e) => e.property === 'encargadoId')).toBe(true);
  });
});
