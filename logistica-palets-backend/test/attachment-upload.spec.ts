/**
 * Endurecimiento de la carga de adjuntos (RL-A-04) contra un PostgreSQL real.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 *
 * Tres defectos convivían en el mismo flujo: multer aceptaba cualquier extensión
 * y sin tope de tamaño (el control estaba después de escribir el archivo entero,
 * que además quedaba en disco), y el `mimeType` se guardaba tal como lo declaraba
 * el cliente y se devolvía como `Content-Type` al descargar. El frontend arma un
 * Blob con ese header y lo abre con `window.open`; un blob URL hereda el origen
 * del documento que lo creó, así que un archivo declarado `text/html` ejecutaba
 * script en el origen del frontend, donde vive el token en `localStorage`.
 */
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { existsSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import {
  attachmentMimeType,
  isAllowedAttachment,
  isInlineSafe,
  MAX_ATTACHMENT_SIZE,
} from '../src/modules/uploads/attachment-types';
import { createTestDataSource, resetDb, seedBasics, TEST_USER_ID } from './test-datasource';
import { Movement } from '../src/modules/movements/entities/movement.entity';

const USER_ID = TEST_USER_ID;
const ENTITY_ID = '00000000-0000-0000-0000-0000000000bb';

let ds: DataSource;
let service: UploadsService;
let tmp: string;

/**
 * Simula lo que multer entrega al servicio, con un archivo real en disco.
 *
 * Se escribe **dentro de `uploads/`**, como hace multer en producción: de ahí
 * sale el `filePath` relativo que guarda el adjunto. Con un archivo en el temp
 * del sistema el path quedaría absoluto y `streamFile` lo rechazaría, con razón.
 */
/**
 * Bytes con los que arranca cada formato, para que el archivo de prueba se
 * parezca al que dice ser. El servicio coteja la firma contra la extensión —un
 * ejecutable renombrado a `.pdf` se rechaza—, así que un contenido de relleno
 * haría fallar los casos que no prueban eso.
 */
const FIRMA_POR_EXTENSION: Record<string, Buffer> = {
  '.pdf': Buffer.from('%PDF-1.4'),
  '.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  '.jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.webp': Buffer.from('RIFF....WEBP'),
  '.docx': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  '.xlsx': Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  '.doc': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  '.xls': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

function contenidoCoherente(originalName: string): Buffer {
  const ext = (originalName.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
  const firma = FIRMA_POR_EXTENSION[ext];
  const relleno = Buffer.from(' contenido de prueba');
  return firma ? Buffer.concat([firma, relleno]) : relleno;
}

function fakeFile(originalName: string, opts: { mimetype?: string; size?: number } = {}) {
  const path = join(tmp, `stored-${Math.random().toString(36).slice(2)}`);
  writeFileSync(path, contenidoCoherente(originalName));
  return {
    originalname: originalName,
    // Lo que declara el cliente. Deliberadamente mentiroso en varios tests.
    mimetype: opts.mimetype ?? 'application/octet-stream',
    size: opts.size ?? 1234,
    path,
  } as unknown as Express.Multer.File;
}

const dto = { name: 'Remito firmado', category: 'REMITO' as const, entityType: 'MOVEMENT' as const, entityId: ENTITY_ID };

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  service = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
  // Subdirectorio real bajo `uploads/`, igual que el `YYYY/MM` de producción.
  tmp = UploadsService.ensureUploadDir('__test__');
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDb(ds);
  // Un movimiento real al que colgar los adjuntos: el servicio ahora verifica
  // que la entidad exista antes de guardar la fila, para que no queden
  // adjuntos huerfanos apuntando a un remito que no esta.
  const base = await seedBasics(ds);
  const repo = ds.getRepository(Movement);
  const movimiento = await repo.save(repo.create({
    id: ENTITY_ID,
    type: 'ENTRY',
    date: new Date(),
    productId: base.product.id,
    quantity: 1,
    warehouseId: base.warehouse.id,
    locationId: base.location.id,
    createdById: TEST_USER_ID,
    status: 'NORMAL',
    voidStatus: 'NONE',
  }));
  expect(movimiento.id).toBe(ENTITY_ID);
});

describe('lista blanca de tipos', () => {
  it.each(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.doc', '.docx', '.xls', '.xlsx'])(
    'admite %s — coincide con el accept del formulario',
    (ext) => {
      expect(isAllowedAttachment(`archivo${ext}`)).toBe(true);
    },
  );

  it.each(['.html', '.htm', '.svg', '.js', '.exe', '.sh', '.php', ''])('rechaza %j', (ext) => {
    expect(isAllowedAttachment(`archivo${ext}`)).toBe(false);
  });

  it('no distingue mayúsculas: FOTO.JPG es una foto', () => {
    expect(isAllowedAttachment('FOTO.JPG')).toBe(true);
    expect(attachmentMimeType('FOTO.JPG')).toBe('image/jpeg');
  });

  it('sólo las imágenes se pueden mostrar embebidas', () => {
    expect(isInlineSafe('image/png')).toBe(true);
    // El visor de PDF ejecuta JavaScript: va como descarga.
    expect(isInlineSafe('application/pdf')).toBe(false);
    expect(isInlineSafe('application/msword')).toBe(false);
  });
});

describe('saveAttachment — el MIME sale de la extensión, no del cliente', () => {
  it('ignora el Content-Type declarado y guarda el de la extensión', async () => {
    const guardado = await service.saveAttachment(
      fakeFile('remito.pdf', { mimetype: 'text/html' }),
      dto,
      USER_ID,
    );

    expect(guardado.mimeType).toBe('application/pdf');
    expect(guardado.mimeType).not.toBe('text/html');
  });

  it('una foto declarada como HTML se guarda como imagen', async () => {
    const guardado = await service.saveAttachment(
      fakeFile('camion.jpg', { mimetype: 'text/html' }),
      dto,
      USER_ID,
    );

    expect(guardado.mimeType).toBe('image/jpeg');
  });
});

describe('saveAttachment — rechazos y limpieza del disco', () => {
  it('rechaza una extensión fuera de la lista blanca', async () => {
    const file = fakeFile('payload.html', { mimetype: 'image/jpeg' });

    await expect(service.saveAttachment(file, dto, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('borra del disco el archivo rechazado — si no, se llena el volumen', async () => {
    const file = fakeFile('payload.html');
    expect(existsSync(file.path)).toBe(true);

    await expect(service.saveAttachment(file, dto, USER_ID)).rejects.toThrow();

    expect(existsSync(file.path)).toBe(false);
  });

  it('rechaza y limpia un archivo que supera el tope', async () => {
    const file = fakeFile('grande.pdf', { size: MAX_ATTACHMENT_SIZE + 1 });

    await expect(service.saveAttachment(file, dto, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(file.path)).toBe(false);
  });

  it('rechaza y limpia si falta el nombre descriptivo', async () => {
    const file = fakeFile('remito.pdf');

    await expect(
      service.saveAttachment(file, { ...dto, name: '   ' }, USER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(existsSync(file.path)).toBe(false);
  });

  it('un rechazo no deja el adjunto registrado en la base', async () => {
    await expect(service.saveAttachment(fakeFile('payload.html'), dto, USER_ID)).rejects.toThrow();

    expect(await ds.getRepository(Attachment).count()).toBe(0);
  });
});

describe('streamFile — el MIME se re-deriva, también para filas viejas', () => {
  /** Inserta un adjunto directo en la base, como los que quedaron de antes. */
  async function filaLegada(originalName: string, mimeType: string) {
    const file = fakeFile('remito.pdf');
    const guardado = await service.saveAttachment(file, dto, USER_ID);
    // Se pisa la columna para reproducir lo que guardó la versión anterior.
    await ds.getRepository(Attachment).update(guardado.id, { originalName, mimeType });
    return guardado.id;
  }

  it('un adjunto guardado con text/html ya no se sirve como HTML', async () => {
    const id = await filaLegada('camion.jpg', 'text/html');

    const { mimeType } = await service.streamFile(id);

    expect(mimeType).toBe('image/jpeg');
  });

  it('una extensión irreconocible cae a un tipo genérico que el navegador no renderiza', async () => {
    const id = await filaLegada('viejo.html', 'text/html');

    const { mimeType } = await service.streamFile(id);

    expect(mimeType).toBe('application/octet-stream');
    expect(isInlineSafe(mimeType)).toBe(false);
  });
});

describe('streamFile — la ruta no puede salir de uploads/', () => {
  it('rechaza un filePath que escapa del directorio', async () => {
    // No hay hoy forma de llegar acá desde la API (multer genera el nombre),
    // pero el invariante tiene que sostenerse si mañana se inserta por otra vía.
    const fila = await ds.getRepository(Attachment).save(
      ds.getRepository(Attachment).create({
        name: 'malicioso', originalName: 'x.pdf', category: 'OTRO',
        mimeType: 'application/pdf', fileSize: 1,
        filePath: '../../../../etc/passwd',
        entityType: 'MOVEMENT', entityId: ENTITY_ID, createdById: USER_ID,
      }),
    );

    await expect(service.streamFile(fila.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
