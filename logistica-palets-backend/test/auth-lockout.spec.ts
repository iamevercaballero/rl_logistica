/**
 * Bloqueo de cuenta y tiempo constante en el login (RL-M-11).
 *
 * Dos problemas distintos con la misma raíz: el login trataba de forma desigual
 * a un usuario que existe y a uno que no.
 *
 *  · Tiempo. Devolvía antes de llegar a `bcrypt.compare` si no encontraba al
 *    usuario. Con coste 12 eso son cientos de milisegundos de diferencia,
 *    medibles desde afuera: se podía averiguar qué nombres existen sin acertar
 *    una sola contraseña.
 *  · Volumen. El límite de tasa es de 5 intentos por minuto **por IP**, así que
 *    no acota nada a quien reparte los intentos entre varias direcciones.
 *
 * Requiere la base de docker-compose.test.yml levantada.
 */
import { DataSource } from 'typeorm';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { AuthEvent } from '../src/modules/auth/entities/auth-event.entity';
import { RefreshSession } from '../src/modules/auth/entities/refresh-session.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import { BCRYPT_COST } from '../src/modules/users/users.service';
import { createTestDataSource, resetDb } from './test-datasource';

const CLAVE = 'Password1';
const MAX = 10; // MAX_INTENTOS_FALLIDOS

let ds: DataSource;
let auth: AuthService;

/**
 * Crea un usuario. El coste por defecto es 4 para que la suite no tarde —lo que
 * se prueba en el bloqueo es la lógica, no el coste—, pero la prueba de tiempo
 * usa el de producción, que es el único valor con el que la medición significa
 * algo.
 */
async function crearUsuario(username: string, coste = 4): Promise<User> {
  const repo = ds.getRepository(User);
  return repo.save(
    repo.create({
      username, fullName: username,
      passwordHash: await bcrypt.hash(CLAVE, coste),
      role: 'OPERATOR', active: true,
    }),
  );
}

/** Falla `veces` veces contra ese usuario. */
async function fallar(username: string, veces: number): Promise<void> {
  for (let i = 0; i < veces; i += 1) {
    await auth.login(username, 'incorrecta').catch(() => undefined);
  }
}

const reasons = () =>
  ds.getRepository(AuthEvent).find({ order: { createdAt: 'ASC' } }).then((f) => f.map((e) => e.reason));

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  const users = new UsersService(ds.getRepository(User), ds.getRepository(UserAuditLog), ds);
  auth = new AuthService(
    users, new JwtService({ secret: 'secreto-de-prueba' }),
    ds.getRepository(AuthEvent), ds.getRepository(RefreshSession),
  );
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
});

describe('bloqueo por intentos fallidos', () => {
  it('deja pasar hasta el límite y bloquea a partir de ahí', async () => {
    const user = await crearUsuario('operador.uno');
    await fallar(user.username, MAX - 1);

    // Todavía no está bloqueado: la contraseña correcta entra.
    await expect(auth.login(user.username, CLAVE)).resolves.toHaveProperty('access_token');
  });

  it('bloquea al llegar al límite, incluso con la contraseña correcta', async () => {
    const user = await crearUsuario('operador.uno');
    await fallar(user.username, MAX);

    await expect(auth.login(user.username, CLAVE)).rejects.toBeInstanceOf(HttpException);
    await expect(auth.login(user.username, CLAVE)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('un ingreso exitoso reinicia la cuenta', async () => {
    // Si no, alguien que entra bien todos los días acumularía fallos sueltos
    // hasta quedar bloqueado sin motivo.
    const user = await crearUsuario('operador.uno');
    await fallar(user.username, MAX - 1);
    await auth.login(user.username, CLAVE);

    await fallar(user.username, MAX - 1);
    await expect(auth.login(user.username, CLAVE)).resolves.toHaveProperty('access_token');
  });

  it('el rechazo por bloqueo no se cuenta a sí mismo', async () => {
    // Si contara, cada intento durante el bloqueo lo renovaría y la ventana
    // deslizante se volvería un bloqueo permanente mientras dure el ataque.
    const user = await crearUsuario('operador.uno');
    await fallar(user.username, MAX);
    await fallar(user.username, 5); // cinco intentos más, ya bloqueado

    const bloqueos = (await reasons()).filter((r) => r === 'ACCOUNT_LOCKED');
    expect(bloqueos.length).toBe(5);

    // La cuenta de fallos que importa sigue siendo MAX, no MAX + 5: al vencer la
    // ventana se desbloquea sola. Se comprueba envejeciendo los eventos.
    await ds.query(`ALTER TABLE "auth_events" DISABLE TRIGGER "trg_auth_events_append_only"`);
    await ds.query(`UPDATE "auth_events" SET "createdAt" = "createdAt" - interval '20 minutes'`);
    await ds.query(`ALTER TABLE "auth_events" ENABLE TRIGGER "trg_auth_events_append_only"`);

    await expect(auth.login(user.username, CLAVE)).resolves.toHaveProperty('access_token');
  });

  it('el bloqueo se aplica igual a un usuario que no existe: no delata cuáles existen', async () => {
    await fallar('no.existe', MAX);

    await expect(auth.login('no.existe', 'cualquiera')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('bloquear una cuenta no bloquea a las demás', async () => {
    const a = await crearUsuario('operador.uno');
    const b = await crearUsuario('operador.dos');
    await fallar(a.username, MAX);

    await expect(auth.login(b.username, CLAVE)).resolves.toHaveProperty('access_token');
  });

  it('deja constancia del bloqueo en la bitácora', async () => {
    const user = await crearUsuario('operador.uno');
    await fallar(user.username, MAX);
    await auth.login(user.username, CLAVE).catch(() => undefined);

    expect(await reasons()).toContain('ACCOUNT_LOCKED');
  });
});

describe('reescritura del hash al coste vigente', () => {
  it('un hash viejo se reescribe al coste actual en el primer ingreso exitoso', async () => {
    // El coste viaja dentro del hash, así que subir BCRYPT_COST no toca los ya
    // guardados: sin esto, quien no cambia la contraseña queda con el coste
    // viejo para siempre.
    const user = await crearUsuario('operador.viejo', 4);
    expect(bcrypt.getRounds(user.passwordHash)).toBe(4);

    await auth.login(user.username, CLAVE);

    const despues = await ds.getRepository(User).findOne({ where: { id: user.id } });
    expect(bcrypt.getRounds(despues!.passwordHash)).toBe(BCRYPT_COST);
    // Y la contraseña sigue siendo la misma.
    expect(await bcrypt.compare(CLAVE, despues!.passwordHash)).toBe(true);
  });

  it('no toca passwordChangedAt: subir el coste no puede echar a nadie de su sesión', async () => {
    // Esa marca invalida los tokens emitidos antes. La contraseña no cambió,
    // sólo se reprotegió.
    const user = await crearUsuario('operador.viejo', 4);
    const antes = (await ds.getRepository(User).findOne({ where: { id: user.id } }))!.passwordChangedAt;

    await auth.login(user.username, CLAVE);

    const despues = (await ds.getRepository(User).findOne({ where: { id: user.id } }))!;
    expect(despues.passwordChangedAt.getTime()).toBe(antes.getTime());
  });

  it('un hash que ya está al coste vigente no se reescribe', async () => {
    const user = await crearUsuario('operador.nuevo', BCRYPT_COST);
    const antes = user.passwordHash;

    await auth.login(user.username, CLAVE);

    const despues = (await ds.getRepository(User).findOne({ where: { id: user.id } }))!;
    expect(despues.passwordHash).toBe(antes);
  });
});

describe('enumeración de usuarios por tiempo', () => {
  it('un usuario inexistente y una contraseña incorrecta cuestan lo mismo', async () => {
    // El hash de descarte existe para esto: sin él, la rama del usuario
    // inexistente volvía en milisegundos y la otra pagaba bcrypt entero.
    //
    // Con el coste de producción, que es la única comparación que significa
    // algo: si el hash de descarte y los reales tuvieran costes distintos, la
    // señal reaparecería invertida.
    const user = await crearUsuario('operador.uno', BCRYPT_COST);

    const medir = async (u: string) => {
      const t0 = process.hrtime.bigint();
      await auth.login(u, 'incorrecta').catch(() => undefined);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };

    // Varias corridas y se toma la mediana: una sola medición es ruido.
    const existentes: number[] = [];
    const inexistentes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      existentes.push(await medir(user.username));
      inexistentes.push(await medir(`fantasma.${i}`));
    }
    const mediana = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const conUsuario = mediana(existentes);
    const sinUsuario = mediana(inexistentes);

    // Sin la corrección, la rama sin usuario era varias veces más rápida. Se
    // exige que estén en el mismo orden de magnitud, no una igualdad exacta:
    // el objetivo es que no haya una señal aprovechable, y la suite corre en
    // una máquina compartida.
    const proporcion = Math.max(conUsuario, sinUsuario) / Math.max(1, Math.min(conUsuario, sinUsuario));
    expect(proporcion).toBeLessThan(3);
  });

  it('la respuesta sigue siendo la misma en ambos casos', async () => {
    const user = await crearUsuario('operador.uno');

    const mensajes: string[] = [];
    await auth.login(user.username, 'incorrecta').catch((e: Error) => mensajes.push(e.message));
    await auth.login('no.existe', 'incorrecta').catch((e: Error) => mensajes.push(e.message));

    expect(mensajes).toEqual(['Credenciales inválidas', 'Credenciales inválidas']);
  });

  it('sigue rechazando con 401, no con otro código, cuando no está bloqueado', async () => {
    await expect(auth.login('no.existe', 'x')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
