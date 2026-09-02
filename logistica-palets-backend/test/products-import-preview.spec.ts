/**
 * Ensayo de la importación de materiales.
 *
 * La auditoría lo marcaba como el control que faltaba: la importación se
 * aplicaba directamente, sin confirmación de lo que iba a crear. El riesgo no es
 * el archivo corrupto —ese ya se rechaza— sino el archivo *válido y equivocado*:
 * una planilla con las columnas corridas pasa todas las validaciones, porque
 * código, descripción y unidad siguen siendo cadenas no vacías, y crea cientos
 * de materiales mal. Y un material con historia no se borra: se desactiva
 * (RL-C-03), así que limpiar eso después es mucho más caro que mirar antes.
 *
 * Ahora `commit=false` es el default y hace un ensayo, igual que la carga del
 * snapshot de stock. Lo que estas pruebas fijan es la propiedad que hace que el
 * ensayo sirva: que valide **exactamente igual** que la importación real. Un
 * ensayo que valide distinto es peor que ninguno, porque promete algo que
 * después no se cumple.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { ProductsService, PREVIEW_MAX_ROWS } from '../src/modules/products/products.service';
import { Product } from '../src/modules/products/entities/product.entity';
import { createTestDataSource, resetDb } from './test-datasource';

let ds: DataSource;
let service: ProductsService;

/** Planilla CSV mínima, con el separador que Excel en español produce. */
function csv(filas: string[][]): Buffer {
  const cabecera = 'codigo;descripcion;unidad;apilable';
  return Buffer.from([cabecera, ...filas.map((f) => f.join(';'))].join('\n'), 'utf8');
}

const contarProductos = () => ds.getRepository(Product).count();

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new ProductsService(ds.getRepository(Product));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('ensayo por defecto', () => {
  it('sin commit no escribe una sola fila', async () => {
    const r = await service.bulkImport(csv([['10001', 'CERVEZA 1L', 'UN', 'SI']]));

    expect(r.committed).toBe(false);
    expect(r.imported).toBe(0);
    expect(await contarProductos()).toBe(0);
  });

  it('pero informa qué crearía, con el detalle de cada fila', async () => {
    const r = await service.bulkImport(
      csv([
        ['10001', 'CERVEZA 1L', 'UN', 'SI'],
        ['10002', 'agua  mineral', 'CJ', 'NO'],
      ]),
    );

    expect(r.valid).toBe(2);
    expect(r.preview).toHaveLength(2);
    // La muestra tiene que mostrar el valor ya normalizado — es lo que se va a
    // guardar. Mostrar el crudo dejaría al operador aprobando otra cosa.
    expect(r.preview[1]).toEqual({
      code: '10002',
      description: 'AGUA MINERAL',
      unitOfMeasure: 'CJ',
      stackable: false,
    });
  });

  it('el ensayo rechaza exactamente lo mismo que la importación real', async () => {
    // La propiedad que hace que el ensayo sirva. Si validaran distinto, el
    // operador aprobaría una cosa y se guardaría otra.
    const planilla = () =>
      csv([
        ['10001', 'VALIDA', 'UN', 'SI'],
        ['', 'SIN CODIGO', 'UN', 'SI'],
        ['ABC', 'CODIGO SIN DIGITOS', 'UN', 'SI'],
        ['10002', '', 'UN', 'SI'],
        ['10003', 'SIN UNIDAD', '', 'SI'],
        ['10001', 'DUPLICADA EN EL ARCHIVO', 'UN', 'SI'],
      ]);

    const ensayo = await service.bulkImport(planilla(), false);
    const real = await service.bulkImport(planilla(), true);

    expect(ensayo.valid).toBe(real.valid);
    expect(ensayo.skipped).toBe(real.skipped);
    expect(ensayo.errors).toEqual(real.errors);
    expect(ensayo.preview).toEqual(real.preview);
    expect(await contarProductos()).toBe(real.imported);
  });

  it('detecta los códigos que ya existen, sin haber escrito nada', async () => {
    await service.bulkImport(csv([['10001', 'YA EXISTE', 'UN', 'SI']]), true);

    const r = await service.bulkImport(csv([['10001', 'REPETIDA', 'UN', 'SI']]));
    expect(r.valid).toBe(0);
    expect(r.errors[0].reason).toMatch(/ya existe/i);
    expect(await contarProductos()).toBe(1);
  });

  it('acota la muestra pero no el conteo', async () => {
    // Con el techo de 50.000 filas por planilla, devolverlas todas haría una
    // respuesta inmanejable. El total sigue siendo exacto.
    const filas = Array.from({ length: PREVIEW_MAX_ROWS + 25 }, (_, i) => [
      String(20000 + i),
      `MATERIAL ${i}`,
      'UN',
      'SI',
    ]);
    const r = await service.bulkImport(csv(filas));

    expect(r.valid).toBe(PREVIEW_MAX_ROWS + 25);
    expect(r.preview).toHaveLength(PREVIEW_MAX_ROWS);
    expect(r.previewTruncated).toBe(true);
    expect(await contarProductos()).toBe(0);
  });

  it('no marca la muestra como truncada cuando entra entera', async () => {
    const r = await service.bulkImport(csv([['10001', 'UNA SOLA', 'UN', 'SI']]));
    expect(r.previewTruncated).toBe(false);
  });
});

describe('confirmación explícita', () => {
  it('con commit escribe y lo dice', async () => {
    const r = await service.bulkImport(
      csv([
        ['10001', 'CERVEZA 1L', 'UN', 'SI'],
        ['10002', 'AGUA', 'CJ', 'NO'],
      ]),
      true,
    );

    expect(r.committed).toBe(true);
    expect(r.imported).toBe(2);
    expect(r.valid).toBe(2);
    expect(await contarProductos()).toBe(2);
  });

  it('guarda el valor normalizado que mostró la muestra', async () => {
    await service.bulkImport(csv([['10007', '  cerveza   negra ', 'un', 'NO']]), true);

    const p = await ds.getRepository(Product).findOneByOrFail({ code: '10007' });
    expect(p.description).toBe('CERVEZA NEGRA');
    expect(p.unitOfMeasure).toBe('UN');
    expect(p.stackable).toBe(false);
    // Un material que no apila tampoco puede recibir peso encima.
    expect(p.canReceiveWeightOnTop).toBe(false);
  });

  it('un archivo sin filas de datos se rechaza en las dos modalidades', async () => {
    const vacio = Buffer.from('codigo;descripcion;unidad;apilable\n', 'utf8');
    await expect(service.bulkImport(vacio, false)).rejects.toThrow(/no contiene filas/i);
    await expect(service.bulkImport(vacio, true)).rejects.toThrow(/no contiene filas/i);
  });
});
