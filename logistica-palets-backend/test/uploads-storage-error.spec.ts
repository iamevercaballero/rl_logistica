/**
 * El almacenamiento de adjuntos sin permiso de escritura.
 *
 * Esto salió de un problema real, reportado en desarrollo: al adjuntar un
 * archivo a un remito, el operador veía «reintentá desde la bitácora del
 * remito». Reintentar ahí fallaba exactamente igual, porque la causa no era
 * transitoria: desde RL-A-10 el backend corre como `node`, y el volumen de
 * adjuntos creado por un arranque anterior pertenece a root, así que
 * `mkdir /app/uploads/2026/09` daba `EACCES`.
 *
 * Diagnosticarlo llevó ir hasta el log del contenedor, y no debería: el error
 * cruzaba tres capas perdiendo información en cada una. `mkdirSync` lanzaba un
 * `EACCES` crudo; el filtro de multer sólo atrapa `MulterError`, así que caía en
 * el global y salía como un 500 genérico; y el frontend tenía un `catch` vacío
 * que lo reemplazaba por un consejo equivocado.
 *
 * Estos casos fijan la primera capa: que el error diga qué pasa y qué hacer.
 */
import { ServiceUnavailableException } from '@nestjs/common';

// `jest.spyOn` no puede redefinir las propiedades del módulo `fs`, así que se
// reemplazan las dos funciones que interesan conservando el resto real.
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

import * as fs from 'fs';
import { UploadsService } from '../src/modules/uploads/uploads.service';

const existsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mkdirSync = fs.mkdirSync as jest.MockedFunction<typeof fs.mkdirSync>;

describe('ensureUploadDir', () => {
  beforeEach(() => jest.clearAllMocks());

  const conFalloAlCrear = (code: string) => {
    existsSync.mockReturnValue(false);
    mkdirSync.mockImplementation(() => {
      const err = new Error(`${code}: permission denied`) as NodeJS.ErrnoException;
      err.code = code;
      throw err;
    });
  };

  it('no intenta crear el directorio si ya existe', () => {
    existsSync.mockReturnValue(true);

    expect(() => UploadsService.ensureUploadDir('2026/09')).not.toThrow();
    expect(mkdirSync).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EPERM', 'EROFS'])(
    'ante %s responde algo accionable, no un error crudo',
    (code) => {
      conFalloAlCrear(code);

      let capturada: unknown;
      try {
        UploadsService.ensureUploadDir('2026/09');
      } catch (e) {
        capturada = e;
      }

      expect(capturada).toBeInstanceOf(ServiceUnavailableException);
      const mensaje = (capturada as ServiceUnavailableException).message;
      // Las tres cosas que el operador necesita saber: qué no se guardó, qué sí,
      // y que no es algo que pueda resolver reintentando.
      expect(mensaje).toMatch(/no admite escritura/i);
      expect(mensaje).toMatch(/el resto de la operación sí/i);
      expect(mensaje).toMatch(/administra el servidor/i);
    },
  );

  it('no filtra la ruta del servidor en el mensaje', () => {
    // Quien lo recibe es el operador, no quien administra la máquina.
    conFalloAlCrear('EACCES');
    try {
      UploadsService.ensureUploadDir('2026/09');
    } catch (e) {
      expect((e as Error).message).not.toMatch(/\/app\/|uploads\/2026/);
    }
  });

  it('cualquier otro error se propaga tal cual', () => {
    // Un ENOSPC o un fallo inesperado no son «permisos»: convertirlos en el
    // mismo mensaje mandaría a revisar el volumen equivocado.
    conFalloAlCrear('ENOSPC');
    expect(() => UploadsService.ensureUploadDir('2026/09')).toThrow(/ENOSPC/);
    expect(() => UploadsService.ensureUploadDir('2026/09')).not.toThrow(
      ServiceUnavailableException,
    );
  });
});
