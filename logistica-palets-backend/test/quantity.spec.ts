import {
  distributeQuantity,
  formatQuantity,
  MIN_QUANTITY,
  parseQuantity,
  quantitiesEqual,
  quantityDelta,
  quantityMismatch,
  roundQuantity,
  sumQuantities,
} from '../src/common/quantity';

describe('parseQuantity — coma o punto decimal', () => {
  it('acepta coma decimal (es-PY)', () => {
    expect(parseQuantity('3537,37')).toBe(3537.37);
    expect(parseQuantity('0,25')).toBe(0.25);
    expect(parseQuantity('1,50')).toBe(1.5);
    expect(parseQuantity('999999,999')).toBe(999999.999);
  });

  it('acepta punto decimal, igual que la coma', () => {
    expect(parseQuantity('3537.37')).toBe(3537.37);
    expect(parseQuantity('0.25')).toBe(0.25);
  });

  it('deduce el decimal cuando hay separadores de miles', () => {
    expect(parseQuantity('3.537,37')).toBe(3537.37);
    expect(parseQuantity('3,537.37')).toBe(3537.37);
    expect(parseQuantity('1.234.567,89')).toBe(1234567.89);
    expect(parseQuantity('1.234.567')).toBe(1234567);
  });

  it('preserva la precisión — no redondea lo recibido', () => {
    expect(parseQuantity('3537,3714')).toBe(3537.3714);
  });

  it('una coma sola con 3 decimales es decimal, no separador de miles (es-PY)', () => {
    // Antes matcheaba como miles en-US (333333); en es-PY la coma es decimal.
    expect(parseQuantity('333,333')).toBe(333.333);
    expect(parseQuantity('1,500')).toBe(1.5);
  });

  it('un number finito pasa tal cual; lo demás es null', () => {
    expect(parseQuantity(42.84)).toBe(42.84);
    expect(parseQuantity(0)).toBe(0);
    expect(parseQuantity(Number.NaN)).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('1,2,3')).toBeNull();
    expect(parseQuantity('1.2.3')).toBeNull();
    expect(parseQuantity(null)).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });
});

describe('roundQuantity / quantitiesEqual — sin residuo de coma flotante', () => {
  it('0,1 + 0,2 se comporta como 0,3', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
    expect(quantitiesEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('acumulación de muchas líneas no deriva', () => {
    let total = 0;
    for (let i = 0; i < 10; i++) total = roundQuantity(total + 0.1);
    expect(total).toBe(1);
  });

  it('un residuo de coma flotante NO cuenta como diferencia (4537,000000000001 = 4537)', () => {
    expect(quantitiesEqual(4537.000000000001, 4537)).toBe(true);
    expect(quantitiesEqual(0.1 + 0.2, 0.3)).toBe(true);
  });

  it('una diferencia real de 0,1 SÍ se detecta (4537 ≠ 4536,9)', () => {
    expect(quantitiesEqual(4537, 4536.9)).toBe(false);
    expect(quantityDelta(4536.9, 4537)).toBe(-0.1);
    expect(quantityDelta(4537, 4536.9)).toBe(0.1);
  });

  it('MIN_QUANTITY es 0.001', () => {
    expect(MIN_QUANTITY).toBe(0.001);
  });
});

describe('sumQuantities — suma exacta por enteros escalados', () => {
  it('el caso de la foto: 8 pallets decimales, suma visible 4537, sin el residuo …0000001', () => {
    // Reparto real que disparaba el rechazo "la suma (4537.000000000001) no
    // coincide con la cantidad total (4537)". La suma float cruda derrapa;
    // sumQuantities suma los enteros escalados y da 4537 exacto.
    const pallets = [429.786, 977.143, 806.407, 214.519, 122.329, 631.159, 728.38, 627.277];
    expect(pallets.reduce((s, n) => s + n, 0)).not.toBe(4537);
    expect(sumQuantities(pallets)).toBe(4537);
    expect(quantitiesEqual(sumQuantities(pallets), 4537)).toBe(true);
  });

  it('8 pallets decimales que suman 4537 kg → 4537 exacto', () => {
    const pallets = [600.5, 550.25, 700.125, 480.375, 650.75, 505.625, 549.5, 499.875];
    expect(sumQuantities(pallets)).toBe(4537);
  });

  it('1000 kg repartido en decimales', () => {
    expect(sumQuantities([275.65, 285.35, 200.55, 238.45])).toBe(1000);
    expect(sumQuantities([333.333, 333.333, 333.334])).toBe(1000);
  });

  it('0,1 + 0,2 = 0,3', () => {
    expect(sumQuantities([0.1, 0.2])).toBe(0.3);
  });

  it('array vacío → 0', () => {
    expect(sumQuantities([])).toBe(0);
  });

  it('una diferencia real de 0,900 no se disuelve en la suma', () => {
    const pallets = [429.786, 977.143, 806.407, 214.519, 122.329, 631.159, 728.38, 626.377];
    expect(sumQuantities(pallets)).toBe(4536.1);
    expect(quantitiesEqual(sumQuantities(pallets), 4537)).toBe(false);
  });
});

describe('quantityMismatch — recibida / distribuido / diferencia', () => {
  it('faltan: 4536,9 distribuidos de 4537 recibidos', () => {
    const m = quantityMismatch(4537, 4536.9);
    expect(m.equal).toBe(false);
    expect(m.over).toBe(false);
    expect(m.diff).toBe(0.1);
    expect(m.message).toBe('distribuido 4.536,9 de 4.537 recibidos — faltan 0,1');
  });

  it('sobran: 4537,5 distribuidos de 4537 recibidos', () => {
    const m = quantityMismatch(4537, 4537.5);
    expect(m.over).toBe(true);
    expect(m.message).toBe('distribuido 4.537,5 de 4.537 recibidos — sobran 0,5');
  });

  it('coinciden dentro de la precisión: sin sufijo de diferencia', () => {
    const m = quantityMismatch(4537, 4537.000000000001);
    expect(m.equal).toBe(true);
    expect(m.message).toBe('distribuido 4.537 de 4.537 recibidos');
  });
});

describe('formatQuantity — formato regional es-PY', () => {
  it('coma decimal y punto de miles', () => {
    expect(formatQuantity(4536.9)).toBe('4.536,9');
    expect(formatQuantity(1000)).toBe('1.000');
    expect(formatQuantity(0.25)).toBe('0,25');
  });

  it('redondea a la escala de la base', () => {
    expect(formatQuantity(4537.000000000001)).toBe('4.537');
  });
});

describe('distributeQuantity — reparte sin perder decimales', () => {
  it('total entero → porciones enteras que suman el total', () => {
    expect(distributeQuantity(100, 3)).toEqual([34, 33, 33]);
    expect(distributeQuantity(10, 2)).toEqual([5, 5]);
  });

  it('total decimal → la suma es exactamente roundQuantity(total)', () => {
    for (const [total, count] of [[100.5, 2], [3537.37, 3], [999999.999, 7]] as const) {
      const parts = distributeQuantity(total, count);
      expect(parts).toHaveLength(count);
      expect(parts.reduce((s, n) => roundQuantity(s + n), 0)).toBe(roundQuantity(total));
    }
  });

  it('count inválido → vacío', () => {
    expect(distributeQuantity(100, 0)).toEqual([]);
  });
});
