import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/**
 * Lectura de planillas subidas por el usuario (.xlsx y .csv), sobre exceljs.
 *
 * Reemplaza a `xlsx` (SheetJS), que arrastra dos vulnerabilidades altas sin
 * parche publicado en npm — prototype pollution y ReDoS — justo en la ruta que
 * procesa archivos que sube un operador. exceljs no lee el formato binario
 * viejo `.xls`, así que ese formato dejó de aceptarse; abajo se detecta para
 * dar un mensaje claro en vez de un error de parseo confuso.
 *
 * Las diferencias de comportamiento respecto de `sheet_to_json` están
 * documentadas en cada función: los números llegan como `number` (antes llegaba
 * el texto ya formateado de la celda) y las fechas como `YYYY-MM-DD`.
 */

/**
 * Techo de filas de una planilla. No acota el parseo en sí — para cuando se
 * evalúa, exceljs ya materializó el archivo en memoria; el límite de 15 MB del
 * upload es lo que acota esa parte. Lo que acota es el trabajo *posterior*:
 * cada fila importada dispara validaciones y escrituras contra la base, y ahí
 * es donde una planilla absurda deja de ser un archivo grande y pasa a ser una
 * carga sostenida sobre PostgreSQL.
 *
 * 50.000 está muy por encima de cualquier uso real (el catálogo de materiales
 * son cientos de filas; el stock inicial, miles) y muy por debajo de lo que
 * haría daño.
 */
export const MAX_SPREADSHEET_ROWS = 50_000;

/** Una fila con las celdas indexadas por el encabezado de su columna. */
export type SpreadsheetRow = Record<string, unknown>;

/**
 * Valor de una celda, normalizado a algo que el resto del código sepa tratar.
 *
 * exceljs devuelve tipos ricos donde `sheet_to_json({ raw: false })` devolvía
 * siempre texto. Se conserva `number` y `boolean` (`parseQuantity` acepta
 * números directamente, y así se evita depender del formato visual de la
 * celda), y se aplana todo lo demás a texto.
 *
 * Las fechas son el punto delicado. exceljs materializa el serial de Excel a
 * medianoche **UTC**, así que sus componentes UTC son exactamente el día que se
 * tipeó en la planilla. Convertirlas a la zona del depósito (UTC-3) restaría
 * tres horas y devolvería el día anterior para toda fecha del archivo. Por eso
 * se toma el día en UTC y se devuelve como `YYYY-MM-DD`, que
 * `parseExcelDateCell` reconoce tal cual. La hora se descarta: ninguna columna
 * de estas importaciones la usa.
 */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((fragment) => fragment.text).join('');
    if ('formula' in value || 'sharedFormula' in value) return cellValue(value.result ?? '');
    if ('hyperlink' in value) return cellValue(value.text ?? '');
    if ('error' in value) return '';
  }
  return value;
}

/** `true` si la celda no aporta nada: vacía o sólo espacios. */
function isBlank(value: unknown): boolean {
  return value === '' || value === null || value === undefined || String(value).trim() === '';
}

/** Firma ZIP (`PK`): todo .xlsx es un ZIP. */
function looksLikeXlsx(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Firma OLE2 del formato binario viejo de Excel (.xls hasta 2003). */
function looksLikeLegacyXls(buffer: Buffer): boolean {
  const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return buffer.length >= OLE2.length && buffer.subarray(0, OLE2.length).equals(OLE2);
}

/**
 * Delimitador de un CSV, deducido de su primera línea con contenido.
 *
 * Excel en español exporta CSV separado por `;`, no por `,`. SheetJS lo
 * detectaba solo; fast-csv (el parser que usa exceljs) asume `,` salvo que se
 * le diga otra cosa, así que sin esto un CSV exportado desde un Excel en
 * español se leería como una sola columna gigante.
 *
 * Las comillas se respetan para no contar separadores que están dentro de un
 * campo: `"Bebida, 1L"` no debe contar como dos columnas.
 */
function sniffDelimiter(text: string): string {
  const CANDIDATES = [',', ';', '\t', '|'];
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';

  let best = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    let count = 0;
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** Quita el BOM UTF-8, que si no termina pegado al primer encabezado. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Primera hoja de una planilla subida. Acepta .xlsx y .csv, y decide cuál es
 * por el contenido y no por el nombre del archivo — el nombre lo elige quien
 * sube, y además así un .csv guardado con nombre .xlsx sigue funcionando, igual
 * que antes.
 */
export async function readUploadedSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('El archivo está vacío.');
  }
  if (looksLikeLegacyXls(buffer)) {
    throw new BadRequestException(
      'El formato .xls (Excel 2003 y anterior) ya no se acepta. Abrí el archivo en Excel y guardalo como .xlsx o .csv.',
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    if (looksLikeXlsx(buffer)) {
      // exceljs declara en sus typings un `Buffer` propio (`extends ArrayBuffer`)
      // que no es el de Node, así que un Buffer real no tipa aunque sea
      // exactamente lo que la librería espera y recibe en runtime.
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } else {
      const text = stripBom(buffer.toString('utf8'));
      await workbook.csv.read(Readable.from([text]), {
        parserOptions: { delimiter: sniffDelimiter(text) },
        // Sin esto, exceljs adivina tipos: convierte a número lo que parezca
        // número y a fecha lo que matchee `MM-DD-YYYY`, que invertiría día y
        // mes en silencio. El texto crudo lo interpretan después
        // `parseQuantity` y `parseExcelDateCell`, que ya saben del formato
        // regional de la planilla.
        map: (datum: unknown) => datum,
      });
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      'No se pudo leer el archivo. Verificá que sea un Excel (.xlsx) o CSV válido y que no esté dañado.',
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('El archivo no contiene hojas con datos.');
  if (sheet.rowCount > MAX_SPREADSHEET_ROWS) {
    throw new BadRequestException(
      `El archivo tiene ${sheet.rowCount} filas y el máximo es ${MAX_SPREADSHEET_ROWS}. Dividilo en varios archivos.`,
    );
  }
  return sheet;
}

/**
 * Filas de datos de una hoja, indexadas por el encabezado de su columna.
 *
 * Equivale a `XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })`:
 * la fila 1 son los encabezados, las celdas vacías son `''` y las filas
 * enteramente vacías se omiten.
 */
export function sheetRows(sheet: ExcelJS.Worksheet): SpreadsheetRow[] {
  const headerRow = sheet.getRow(1);
  const columnCount = Math.max(sheet.columnCount, headerRow.cellCount);

  const headers = new Map<number, string>();
  for (let column = 1; column <= columnCount; column += 1) {
    const header = String(cellValue(headerRow.getCell(column).value)).trim();
    if (header) headers.set(column, header);
  }
  if (headers.size === 0) return [];

  const rows: SpreadsheetRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const entry: SpreadsheetRow = {};
    let hasContent = false;
    for (const [column, header] of headers) {
      const value = cellValue(row.getCell(column).value);
      entry[header] = value;
      if (!isBlank(value)) hasContent = true;
    }
    if (hasContent) rows.push(entry);
  }
  return rows;
}

/** Atajo para el caso habitual: leer un archivo subido como filas con encabezado. */
export async function readUploadedRows(buffer: Buffer): Promise<SpreadsheetRow[]> {
  return sheetRows(await readUploadedSheet(buffer));
}

/**
 * Hoja completa como matriz, sin encabezados.
 *
 * Equivale a `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })`: se
 * conservan las filas vacías para que el índice del array siga siendo la
 * posición real en la planilla (índice 0 = fila 1), porque el seed selecciona
 * sus datos por número de fila.
 */
export function sheetMatrix(sheet: ExcelJS.Worksheet | undefined): unknown[][] {
  if (!sheet) return [];
  const columnCount = sheet.columnCount;
  const matrix: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells: unknown[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      cells.push(cellValue(row.getCell(column).value));
    }
    matrix.push(cells);
  }
  return matrix;
}
