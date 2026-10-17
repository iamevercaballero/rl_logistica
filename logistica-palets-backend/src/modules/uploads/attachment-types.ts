import { extname } from 'path';

/**
 * Tipos de archivo admitidos como adjunto, y el MIME con el que se sirven.
 *
 * El MIME **se deriva de la extensión, nunca se toma del cliente**. `file.mimetype`
 * lo declara quien sube el archivo, y antes se guardaba tal cual y se devolvía como
 * `Content-Type` al descargarlo. El frontend arma un Blob con ese header y lo abre
 * con `window.open`; un blob URL hereda el origen del documento que lo creó, así
 * que un archivo declarado `text/html` terminaba ejecutando script en el origen
 * del frontend — donde vive el token en `localStorage`. El CSP de helmet protege
 * el origen de la API, no ese.
 *
 * La lista replica el `accept` del formulario de carga: lo que el operador puede
 * elegir es lo que el servidor acepta, sin sorpresas de un lado ni del otro.
 */
export const ALLOWED_ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Tamaño máximo de un adjunto. Lo aplica multer, que corta el stream al llegar. */
export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

/** Extensiones admitidas, para los mensajes de error. */
export const ALLOWED_ATTACHMENT_EXTENSIONS = Object.keys(ALLOWED_ATTACHMENT_TYPES);

/** Extensión normalizada de un nombre de archivo (`.JPG` → `.jpg`). */
export function attachmentExtension(originalName: string): string {
  return extname(originalName ?? '').toLowerCase();
}

/** `true` si la extensión está admitida. */
export function isAllowedAttachment(originalName: string): boolean {
  return attachmentExtension(originalName) in ALLOWED_ATTACHMENT_TYPES;
}

/**
 * MIME con el que se guarda y se sirve el archivo, derivado de su extensión.
 * Devuelve `null` para una extensión no admitida — el caller debe rechazarla.
 */
export function attachmentMimeType(originalName: string): string | null {
  return ALLOWED_ATTACHMENT_TYPES[attachmentExtension(originalName)] ?? null;
}

/**
 * ¿Se puede mostrar en el navegador sin riesgo?
 *
 * Sólo imágenes. El PDF va como descarga: su visor ejecuta JavaScript y no hace
 * falta abrirlo embebido para que el flujo funcione — el frontend lo abre en una
 * pestaña propia a partir de un Blob. Los documentos de Office nunca son inline.
 */
export function isInlineSafe(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Bytes con los que arranca cada formato. Varias extensiones comparten firma
 * —`.docx`/`.xlsx` son ZIP, `.doc`/`.xls` son contenedores OLE2— y eso está
 * bien: lo que se descarta es el archivo cuyo contenido no se parece en nada a
 * lo que dice la extensión.
 */
const FIRMAS: Readonly<Record<string, readonly number[][]>> = {
  '.pdf': [[0x25, 0x50, 0x44, 0x46]], // %PDF
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF (el "WEBP" va en el byte 8)
  '.doc': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // OLE2
  '.xls': [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  '.docx': [[0x50, 0x4b]], // PK (ZIP)
  '.xlsx': [[0x50, 0x4b]],
};

/** Bytes que hay que leer del archivo para poder decidir. */
export const FIRMA_BYTES = 12;

/**
 * `true` si el contenido se condice con la extensión declarada.
 *
 * La validación por extensión sola deja pasar un ejecutable renombrado a
 * `.pdf`: se guardaba con `mimeType: application/pdf` y el operador que lo
 * descargaba recibía un `.exe`. Es el mismo criterio que `common/spreadsheet.ts`
 * ya aplica al leer planillas subidas, donde mira la firma antes de parsear.
 *
 * `.heic` no está en la tabla: su firma vive en el byte 4 (`ftyp`) con varias
 * marcas posibles, así que se acepta sin comprobar el contenido en vez de
 * rechazar fotos legítimas de un iPhone.
 */
export function contentMatchesExtension(header: Buffer, originalName: string): boolean {
  const firmas = FIRMAS[attachmentExtension(originalName)];
  if (!firmas) return true; // extensión sin firma conocida (.heic): no se juzga
  return firmas.some((firma) => firma.every((byte, i) => header[i] === byte));
}

export const CONTENT_MISMATCH_MESSAGE =
  'El contenido del archivo no coincide con su extensión. Verificá que no esté renombrado o dañado.';

/** Mensaje único para el rechazo por tipo, para que diga siempre lo mismo. */
export const UNSUPPORTED_ATTACHMENT_MESSAGE =
  `Formato no admitido. Se aceptan: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')}.`;
