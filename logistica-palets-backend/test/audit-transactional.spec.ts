/**
 * Auditoría dentro de la transacción (RL-A-05) contra un PostgreSQL real.
 *
 * Había dos problemas en el mismo patrón. Las 13 escrituras de bitácora iban con
 * `void this.uploads.log(...)` y sin `.catch()`: en Node 20 una promesa
 * rechazada sin manejar **termina el proceso** (verificado sobre la propia imagen
 * de producción), así que un fallo escribiendo un evento se llevaba puesta toda
 * petición en vuelo. Y como se escribían fuera de la transacción del negocio,
 * una caída entre el commit y el log dejaba un movimiento sin rastro de quién lo
 * hizo — justo el dato que la trazabilidad necesita.
 */
import { DataSource, EntityManager } from 'typeorm';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { Attachment } from '../src/modules/uploads/entities/attachment.entity';
import { DocumentEvent } from '../src/modules/uploads/entities/document-event.entity';
import { createTestDataSource, resetDb } from './test-datasource';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const ENTITY_ID = '00000000-0000-0000-0000-0000000000cc';

let ds: DataSource;
let uploads: UploadsService;

const contarEventos = () => ds.getRepository(DocumentEvent).count();

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  uploads = new UploadsService(ds.getRepository(Attachment), ds.getRepository(DocumentEvent));
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('log() sin manager — comportamiento de siempre', () => {
  it('escribe el evento contra la conexión por defecto', async () => {
    await uploads.log({
      entityType: 'MOVEMENT', entityId: ENTITY_ID, eventType: 'CREADO',
      description: 'evento suelto', userId: USER_ID,
    });

    expect(await contarEventos()).toBe(1);
  });
});

describe('log() con manager — participa de la transacción', () => {
  it('el evento se confirma junto con la operación', async () => {
    await ds.transaction(async (manager: EntityManager) => {
      await uploads.log({
        entityType: 'MOVEMENT', entityId: ENTITY_ID, eventType: 'CREADO',
        description: 'evento transaccional', userId: USER_ID, manager,
      });
    });

    expect(await contarEventos()).toBe(1);
  });

  it('si la operación revierte, el evento NO queda — lo que evita una bitácora que miente', async () => {
    await expect(
      ds.transaction(async (manager: EntityManager) => {
        await uploads.log({
          entityType: 'MOVEMENT', entityId: ENTITY_ID, eventType: 'CREADO',
          description: 'evento que no debe sobrevivir', userId: USER_ID, manager,
        });
        throw new Error('la operación falló después de registrar');
      }),
    ).rejects.toThrow('la operación falló después de registrar');

    expect(await contarEventos()).toBe(0);
  });

  it('sin manager el evento sobrevive al rollback — el bug que se estaba corrigiendo', async () => {
    // Documenta por qué el `manager` importa: escribiendo por fuera, el evento
    // queda registrado aunque la operación que lo originó nunca haya ocurrido.
    await expect(
      ds.transaction(async () => {
        await uploads.log({
          entityType: 'MOVEMENT', entityId: ENTITY_ID, eventType: 'CREADO',
          description: 'evento huérfano', userId: USER_ID,
        });
        throw new Error('la operación falló');
      }),
    ).rejects.toThrow();

    expect(await contarEventos()).toBe(1);
  });
});

describe('un fallo al escribir la bitácora se propaga, no se traga', () => {
  it('rechaza en vez de resolver en silencio', async () => {
    // `entityType` es varchar(20): pasarse hace fallar el INSERT. Antes esto
    // volvía como promesa rechazada sin manejar y terminaba el proceso.
    await expect(
      uploads.log({
        entityType: 'X'.repeat(50), entityId: ENTITY_ID,
        eventType: 'CREADO', description: 'demasiado largo', userId: USER_ID,
      }),
    ).rejects.toBeDefined();

    expect(await contarEventos()).toBe(0);
  });

  it('dentro de una transacción, el fallo arrastra la operación entera', async () => {
    await expect(
      ds.transaction(async (manager: EntityManager) => {
        await uploads.log({
          entityType: 'X'.repeat(50), entityId: ENTITY_ID,
          eventType: 'CREADO', description: 'demasiado largo', userId: USER_ID, manager,
        });
      }),
    ).rejects.toBeDefined();

    expect(await contarEventos()).toBe(0);
  });
});
