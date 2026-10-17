/**
 * Topes y validaciones que faltaban, encontrados probando la operación real
 * sobre el inventario cargado.
 *
 * Los tres casos tenían la misma forma: el DTO los dejaba pasar y el valor
 * reventaba recién contra PostgreSQL, que sale como un 500 y un "ocurrió un
 * error inesperado". Un operador que tipea mal una cantidad o una fecha tiene
 * que leer qué corregir, no un código de soporte.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateMovementDto, PalletItemDto } from '../src/modules/movements/dto/create-movement.dto';
import { CreateDocumentDto } from '../src/modules/movements/dto/create-document.dto';
import { MAX_QUANTITY, MAX_WEIGHT, MIN_QUANTITY } from '../src/common/quantity';

/** Errores de validación como lista plana de "propiedad: restricción". */
async function erroresDe(dto: object): Promise<string[]> {
  const errores = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const plano: string[] = [];
  const recorrer = (lista: typeof errores, prefijo = '') => {
    for (const e of lista) {
      const ruta = prefijo ? `${prefijo}.${e.property}` : e.property;
      if (e.constraints) for (const c of Object.keys(e.constraints)) plano.push(`${ruta}:${c}`);
      if (e.children?.length) recorrer(e.children, ruta);
    }
  };
  recorrer(errores);
  return plano;
}

const palet = (extra: Record<string, unknown> = {}) => ({
  lotCode: 'L-1', quantity: 10, fechaVencimiento: '2029-01-31', ...extra,
});

const movimiento = (extra: Record<string, unknown> = {}) =>
  plainToInstance(CreateMovementDto, {
    type: 'ENTRY',
    productId: '11111111-1111-4111-8111-111111111111',
    palletItems: [palet()],
    ...extra,
  });

const documento = (lineaExtra: Record<string, unknown> = {}) =>
  plainToInstance(CreateDocumentDto, {
    type: 'ENTRY',
    encargadoId: '22222222-2222-4222-8222-222222222222',
    lines: [{
      productId: '11111111-1111-4111-8111-111111111111',
      palletItems: [palet()],
      ...lineaExtra,
    }],
  });

describe('tope de cantidad — numeric(14,3)', () => {
  it('acepta el máximo exacto que entra en la columna', async () => {
    const dto = movimiento({ palletItems: [palet({ quantity: MAX_QUANTITY })] });
    expect(await erroresDe(dto)).toEqual([]);
  });

  /**
   * El caso que llegaba a la base: pasaba el DTO por ser un número de tres
   * decimales, y PostgreSQL respondía `numeric field overflow`.
   */
  it('rechaza una cantidad que desborda la columna', async () => {
    const dto = movimiento({ palletItems: [palet({ quantity: 99999999999999 })] });
    expect(await erroresDe(dto)).toContain('palletItems.0.quantity:max');
  });

  it('también la rechaza en la línea de un documento, que es la ruta de la pantalla', async () => {
    const dto = documento({ quantity: 99999999999999, palletItems: undefined });
    expect(await erroresDe(dto)).toContain('lines.0.quantity:max');
  });

  it('sigue rechazando el cero y los negativos', async () => {
    expect(await erroresDe(movimiento({ palletItems: [palet({ quantity: 0 })] })))
      .toContain('palletItems.0.quantity:min');
    expect(await erroresDe(movimiento({ palletItems: [palet({ quantity: -1 })] })))
      .toContain('palletItems.0.quantity:min');
  });

  it('acepta el mínimo representable (una milésima)', async () => {
    expect(await erroresDe(movimiento({ palletItems: [palet({ quantity: MIN_QUANTITY })] }))).toEqual([]);
  });

  it('rechaza un peso que desborda numeric(10,2)', async () => {
    const dto = movimiento({ palletItems: [palet({ weightKg: MAX_WEIGHT + 1 })] });
    expect(await erroresDe(dto)).toContain('palletItems.0.weightKg:max');
  });
});

describe('fecha de negocio — tiene que existir en el calendario', () => {
  /**
   * El validador sólo comprobaba el formato con una regex, aunque su mensaje
   * prometiera "fecha calendario". `2029-02-30` lo cumplía y PostgreSQL
   * respondía `date/time field value out of range`.
   */
  it.each(['2029-02-30', '2029-02-31', '2029-04-31', '2029-13-01', '2029-00-10', '2029-01-32'])(
    'rechaza %s, que no existe',
    async (fecha) => {
      const dto = movimiento({ palletItems: [palet({ fechaVencimiento: fecha })] });
      expect(await erroresDe(dto)).toContain('palletItems.0.fechaVencimiento:isBusinessDateString');
    },
  );

  it.each(['2028-02-29', '2029-02-28', '2029-12-31', '2026-01-01'])(
    'acepta %s, que sí existe',
    async (fecha) => {
      const dto = movimiento({ palletItems: [palet({ fechaVencimiento: fecha })] });
      expect(await erroresDe(dto)).toEqual([]);
    },
  );

  it('2029 no es bisiesto: el 29 de febrero se rechaza', async () => {
    const dto = movimiento({ palletItems: [palet({ fechaVencimiento: '2029-02-29' })] });
    expect(await erroresDe(dto)).toContain('palletItems.0.fechaVencimiento:isBusinessDateString');
  });

  it('sigue rechazando el formato DD/MM/AAAA', async () => {
    const dto = movimiento({ palletItems: [palet({ fechaVencimiento: '31/01/2029' })] });
    expect(await erroresDe(dto)).toContain('palletItems.0.fechaVencimiento:isBusinessDateString');
  });
});

describe('tope de palets por línea de documento', () => {
  /**
   * `CreateMovementDto` acotaba sus `palletItems` a 200 porque cada palet abre
   * su propio bloqueo pesimista dentro de la transacción. El DTO de documento
   * —la ruta que usan entradas y salidas desde la pantalla— no tenía el tope,
   * y aceptaba cualquier cantidad.
   */
  it('rechaza más de 200 palets en una línea', async () => {
    const muchos = Array.from({ length: 201 }, (_, i) => palet({ lotCode: `L-${i}` }));
    const dto = documento({ palletItems: muchos });
    expect(await erroresDe(dto)).toContain('lines.0.palletItems:arrayMaxSize');
  });

  it('acepta exactamente 200', async () => {
    const justos = Array.from({ length: 200 }, (_, i) => palet({ lotCode: `L-${i}` }));
    const dto = documento({ palletItems: justos });
    expect(await erroresDe(dto)).toEqual([]);
  });

  it('rechaza más de 100 líneas en un documento', async () => {
    const dto = plainToInstance(CreateDocumentDto, {
      type: 'ENTRY',
      encargadoId: '22222222-2222-4222-8222-222222222222',
      lines: Array.from({ length: 101 }, () => ({
        productId: '11111111-1111-4111-8111-111111111111',
        palletItems: [palet()],
      })),
    });
    expect(await erroresDe(dto)).toContain('lines:arrayMaxSize');
  });

  it('el PalletItemDto suelto sigue validando igual', async () => {
    const item = plainToInstance(PalletItemDto, palet({ quantity: MAX_QUANTITY + 1 }));
    expect(await erroresDe(item)).toContain('quantity:max');
  });
});
