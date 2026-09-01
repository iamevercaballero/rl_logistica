import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

/**
 * Filtro global de excepciones (RL-M-14).
 *
 * Lo que importa acá, además de que normalice, es lo que NO cambia: el frontend
 * lee `data.message` y acepta tanto una cadena como el array que devuelve
 * class-validator. Reescribir esa forma rompería en silencio los mensajes de
 * toda la aplicación, así que el filtro agrega campos y no reemplaza los que ya
 * había.
 *
 * Sin base de datos: es lógica pura.
 */

function contexto(reqId?: string) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const req = { method: 'POST', url: '/api/movements', id: reqId };
  return {
    host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost,
    res,
  };
}

const cuerpo = (res: { json: jest.Mock }) => res.json.mock.calls[0][0] as Record<string, unknown>;

let filtro: AllExceptionsFilter;
let errores: jest.SpyInstance;

beforeEach(() => {
  filtro = new AllExceptionsFilter();
  // El filtro registra por su cuenta; se silencia para no ensuciar la salida.
  errores = jest.spyOn((filtro as unknown as { logger: { error: () => void } }).logger, 'error')
    .mockImplementation(() => undefined);
});

afterEach(() => errores.mockRestore());

describe('excepciones HTTP: se preservan tal como estaban', () => {
  it('mantiene el estado y el mensaje de una excepción con texto suelto', () => {
    const { host, res } = contexto('req-1');
    filtro.catch(new ForbiddenException('No podés aprobar una solicitud que creaste vos.'), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(cuerpo(res)).toMatchObject({
      statusCode: 403,
      message: 'No podés aprobar una solicitud que creaste vos.',
      requestId: 'req-1',
    });
  });

  it('mantiene el ARRAY de mensajes de class-validator', () => {
    // Es lo que rompería los formularios si el filtro aplanara el cuerpo: el
    // frontend toma el primer elemento cuando es un array.
    const { host, res } = contexto();
    filtro.catch(new BadRequestException(['code no puede estar vacío', 'quantity debe ser positivo']), host);

    expect(cuerpo(res).message).toEqual(['code no puede estar vacío', 'quantity debe ser positivo']);
  });

  it('no registra los 4xx: son operación normal, no fallas del servidor', () => {
    const { host } = contexto();
    filtro.catch(new BadRequestException('Datos inválidos'), host);
    expect(errores).not.toHaveBeenCalled();
  });

  it('sí registra los 5xx declarados como HttpException', () => {
    const { host } = contexto();
    filtro.catch(new InternalServerErrorException('la base no responde'), host);
    expect(errores).toHaveBeenCalled();
  });
});

describe('excepciones no controladas', () => {
  it('responde 500 con un mensaje genérico y no con el del error', () => {
    // El mensaje original puede nombrar tablas, columnas o rutas del servidor.
    const { host, res } = contexto('req-9');
    filtro.catch(new Error('relation "movements" does not exist en /app/dist/x.js'), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = cuerpo(res);
    expect(String(body.message)).not.toContain('movements');
    expect(String(body.message)).not.toContain('/app/dist');
    expect(body.requestId).toBe('req-9');
  });

  it('registra el error con su stack del lado del servidor', () => {
    const { host } = contexto();
    filtro.catch(new Error('algo se rompió'), host);

    expect(errores).toHaveBeenCalled();
    const [mensaje, stack] = errores.mock.calls[0];
    expect(String(mensaje)).toContain('algo se rompió');
    expect(String(stack)).toContain('Error');
  });

  it('sobrevive a algo que ni siquiera es un Error', () => {
    const { host, res } = contexto();
    filtro.catch('un string suelto', host);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe('id de correlación', () => {
  it('viaja en toda respuesta de error', () => {
    const { host, res } = contexto('abc-123');
    filtro.catch(new ForbiddenException('x'), host);
    expect(cuerpo(res).requestId).toBe('abc-123');
  });

  it('es null si la petición no lo trae, en vez de romper', () => {
    const { host, res } = contexto(undefined);
    filtro.catch(new ForbiddenException('x'), host);
    expect(cuerpo(res).requestId).toBeNull();
  });
});
