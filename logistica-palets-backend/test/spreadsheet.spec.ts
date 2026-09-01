import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { readUploadedRows, readUploadedSheet, sheetMatrix } from '../src/common/spreadsheet';
import { parseExcelDateCell } from '../src/common/date';
import { parseQuantity } from '../src/common/quantity';

/**
 * Contrato del lector de planillas que reemplazó a `xlsx` (SheetJS) por exceljs.
 *
 * Los casos de acá no son hipotéticos: son las diferencias concretas entre
 * `sheet_to_json` y exceljs que, si se resuelven mal, corrompen datos en
 * silencio en vez de fallar — una fecha corrida un día, un CSV exportado desde
 * un Excel en español leído como una sola columna, un número interpretado con
 * el formato visual de la celda en vez de su valor.
 */

/** Arma un .xlsx real (fila = array de celdas) para leerlo de vuelta. */
async function xlsxBuffer(
  rows: unknown[][],
  sheetName = 'Hoja1',
  extra?: (ws: ExcelJS.Worksheet) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((cells, index) => {
    const row = ws.getRow(index + 1);
    cells.forEach((value, column) => {
      row.getCell(column + 1).value = value as ExcelJS.CellValue;
    });
    row.commit();
  });
  extra?.(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const csvBuffer = (text: string) => Buffer.from(text, 'utf8');

describe('readUploadedRows — Excel (.xlsx)', () => {
  it('usa la fila 1 como encabezados y deja las celdas vacías como cadena vacía', async () => {
    const buffer = await xlsxBuffer([
      ['Codigo', 'Descripcion', 'UMB'],
      ['1001', 'CERVEZA 1L', 'UN'],
      ['1002', 'GASEOSA 500ML', ''],
    ]);

    expect(await readUploadedRows(buffer)).toEqual([
      { Codigo: '1001', Descripcion: 'CERVEZA 1L', UMB: 'UN' },
      { Codigo: '1002', Descripcion: 'GASEOSA 500ML', UMB: '' },
    ]);
  });

  it('omite las filas enteramente vacías, como hacía sheet_to_json', async () => {
    const buffer = await xlsxBuffer([
      ['Codigo', 'Descripcion'],
      ['1001', 'CERVEZA'],
      ['', ''],
      ['1002', 'GASEOSA'],
    ]);

    const rows = await readUploadedRows(buffer);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.Codigo)).toEqual(['1001', '1002']);
  });

  it('ignora las columnas sin encabezado', async () => {
    const buffer = await xlsxBuffer([
      ['Codigo', '', 'UMB'],
      ['1001', 'basura sin encabezado', 'UN'],
    ]);

    expect(await readUploadedRows(buffer)).toEqual([{ Codigo: '1001', UMB: 'UN' }]);
  });

  it('devuelve los números como number, no como el texto formateado de la celda', async () => {
    // `sheet_to_json({ raw: false })` devolvía lo que la celda *muestra*, así que
    // una cantidad con formato de miles llegaba como "1.234,5" y dependía de que
    // `parseQuantity` adivinara bien el formato regional. Ahora llega el valor.
    const buffer = await xlsxBuffer(
      [
        ['Codigo', 'Stock'],
        [1001, 1234.5],
      ],
      'Hoja1',
      (ws) => {
        ws.getCell('B2').numFmt = '#.##0,0';
      },
    );

    const [row] = await readUploadedRows(buffer);
    expect(row.Stock).toBe(1234.5);
    expect(parseQuantity(row.Stock)).toBe(1234.5);
    // El código numérico sigue siendo utilizable como texto aguas abajo.
    expect(String(row.Codigo)).toBe('1001');
  });

  it('no corre las fechas un día al normalizarlas', async () => {
    // exceljs materializa el serial de Excel a medianoche UTC. Tomar sus
    // componentes *locales* en una máquina UTC-3 (Asunción) devuelve el día
    // anterior: el 05/08 se guardaría como 04/08 en cada lote importado.
    //
    // Este test es sensible a la zona del proceso: en una máquina UTC pasaría
    // aun con la implementación equivocada. En las máquinas de desarrollo
    // (UTC-3) falla, que es donde importa.
    const buffer = await xlsxBuffer([
      ['Codigo', 'Fecha de Vto'],
      ['1001', new Date(Date.UTC(2026, 7, 5))],
    ]);

    const [row] = await readUploadedRows(buffer);
    // Texto plano, no un Date: así no queda margen para que aguas abajo alguien
    // lo convierta a la zona del depósito y vuelva a correrlo.
    expect(row['Fecha de Vto']).toBe('2026-08-05');
    expect(parseExcelDateCell(row['Fecha de Vto'])).toBe('2026-08-05');
  });

  it('aplana fórmulas, texto enriquecido, hipervínculos y celdas de error', async () => {
    const buffer = await xlsxBuffer([['A', 'B', 'C', 'D']], 'Hoja1', (ws) => {
      ws.getCell('A2').value = { formula: 'SUM(1,2)', result: 3 } as ExcelJS.CellValue;
      ws.getCell('B2').value = {
        richText: [{ text: 'CERVEZA ' }, { text: '1L' }],
      } as ExcelJS.CellValue;
      ws.getCell('C2').value = {
        text: 'ver ficha',
        hyperlink: 'https://ejemplo.test/ficha',
      } as ExcelJS.CellValue;
      ws.getCell('D2').value = { error: '#DIV/0!' } as ExcelJS.CellValue;
    });

    expect(await readUploadedRows(buffer)).toEqual([
      { A: 3, B: 'CERVEZA 1L', C: 'ver ficha', D: '' },
    ]);
  });
});

describe('readUploadedRows — CSV', () => {
  it('lee un CSV separado por comas', async () => {
    const buffer = csvBuffer('Codigo,Descripcion,UMB\n1001,CERVEZA 1L,UN\n');
    expect(await readUploadedRows(buffer)).toEqual([
      { Codigo: '1001', Descripcion: 'CERVEZA 1L', UMB: 'UN' },
    ]);
  });

  it('lee un CSV separado por punto y coma, que es como exporta Excel en español', async () => {
    // Sin detectar el delimitador, fast-csv asume "," y todo el archivo se lee
    // como una sola columna: ningún encabezado matchea y la importación entera
    // se reporta como filas inválidas.
    const buffer = csvBuffer('Codigo;Descripcion;UMB\n1001;CERVEZA 1L;UN\n');
    expect(await readUploadedRows(buffer)).toEqual([
      { Codigo: '1001', Descripcion: 'CERVEZA 1L', UMB: 'UN' },
    ]);
  });

  it('no cuenta como delimitador el que está dentro de comillas', async () => {
    const buffer = csvBuffer('Codigo,Descripcion\n1001,"CERVEZA, 1L"\n');
    expect(await readUploadedRows(buffer)).toEqual([
      { Codigo: '1001', Descripcion: 'CERVEZA, 1L' },
    ]);
  });

  it('no interpreta las fechas por su cuenta: 05/08/2026 es 5 de agosto, no 8 de mayo', async () => {
    // exceljs, librado a sí mismo, intenta parsear fechas con formatos que
    // incluyen MM-DD-YYYY e invierte día y mes en silencio para todo día ≤ 12.
    // Por eso el mapa de tipos está desactivado y el texto lo interpreta
    // `parseExcelDateCell`, que parsea DD/MM/AAAA explícitamente.
    const buffer = csvBuffer('Codigo,Fecha de Vto\n1001,05/08/2026\n');

    const [row] = await readUploadedRows(buffer);
    expect(row['Fecha de Vto']).toBe('05/08/2026');
    expect(parseExcelDateCell(row['Fecha de Vto'])).toBe('2026-08-05');
  });

  it('descarta el BOM para que no quede pegado al primer encabezado', async () => {
    const buffer = csvBuffer('﻿Codigo,Descripcion\n1001,CERVEZA\n');
    const [row] = await readUploadedRows(buffer);
    expect(Object.keys(row)).toEqual(['Codigo', 'Descripcion']);
  });
});

describe('readUploadedSheet — archivos que no se pueden procesar', () => {
  it('rechaza un archivo vacío', async () => {
    await expect(readUploadedSheet(Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('explica cómo salir del formato .xls viejo en vez de fallar con un error de parseo', async () => {
    // Firma OLE2 del binario de Excel 2003. exceljs no lo lee y sin esta
    // detección el operador vería "archivo dañado" para un archivo sano.
    const ole2 = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(64),
    ]);

    await expect(readUploadedSheet(ole2)).rejects.toThrow(/\.xlsx o \.csv/);
  });

  it('rechaza un ZIP que no es un Excel sin filtrar el error interno', async () => {
    const zipRoto = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(128, 0x41)]);

    await expect(readUploadedSheet(zipRoto)).rejects.toBeInstanceOf(BadRequestException);
    await expect(readUploadedSheet(zipRoto)).rejects.toThrow(/No se pudo leer el archivo/);
  });
});

describe('sheetMatrix — lectura por posición (la que usa el seed)', () => {
  it('mantiene la correspondencia índice 0 = fila 1 conservando las filas vacías', async () => {
    const sheet = await readUploadedSheet(
      await xlsxBuffer([['encabezado'], [], [], ['dato']]),
    );

    const matrix = sheetMatrix(sheet);
    expect(matrix).toHaveLength(4);
    expect(matrix[0][0]).toBe('encabezado');
    expect(matrix[1][0]).toBe('');
    expect(matrix[3][0]).toBe('dato');
  });

  it('indexa las columnas desde 0 y conserva el tipo numérico de los códigos', async () => {
    // El seed filtra sus filas con `typeof r[3] === 'number'` sobre la columna
    // de código, así que el tipo importa tanto como la posición.
    const sheet = await readUploadedSheet(await xlsxBuffer([['a', 'b', 'c', 1001]]));

    const [row] = sheetMatrix(sheet);
    expect(row[0]).toBe('a');
    expect(row[3]).toBe(1001);
    expect(typeof row[3]).toBe('number');
  });

  it('devuelve una matriz vacía si la hoja no existe', () => {
    expect(sheetMatrix(undefined)).toEqual([]);
  });
});
