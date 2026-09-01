/**
 * Usuarios y Permisos: techo del último ADMIN, techo de privilegios de
 * MANAGER, y permisos efectivos (rol + overrides).
 *
 * Lo que se protege acá es exactamente lo que pide la spec: que el sistema
 * nunca quede sin un ADMIN activo (ni por desactivación, ni por cambio de
 * rol, ni por una condición de carrera), que un MANAGER no pueda escalar
 * privilegios propios ni ajenos, y que DENY/ALLOW por usuario prevalezcan
 * sobre la plantilla del rol sin tocarla.
 */
import { DataSource } from 'typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../src/modules/users/users.service';
import { PermissionsService } from '../src/modules/permissions/permissions.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UserAuditLog } from '../src/modules/users/entities/user-audit-log.entity';
import {
  createPermissionsService,
  createTestDataSource,
  resetDb,
  seedRolePermissions,
} from './test-datasource';

let ds: DataSource;
let users: UsersService;
let permissions: PermissionsService;

beforeAll(async () => {
  ds = createTestDataSource();
  await ds.initialize();
  permissions = createPermissionsService(ds);
}, 60_000);

afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

beforeEach(async () => {
  await resetDb(ds);
  await seedRolePermissions(ds);
  users = new UsersService(ds.getRepository(User), ds.getRepository(UserAuditLog), ds);
});

/** Alta directa vía repo — evita pasar por `createWithPassword` cuando el test no necesita ejercitarlo. */
async function makeUser(role: 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR', opts: { active?: boolean; username?: string } = {}) {
  const repo = ds.getRepository(User);
  const saved = await repo.save(repo.create({
    username: opts.username ?? `${role.toLowerCase()}.${Math.random().toString(36).slice(2, 8)}`,
    passwordHash: await bcrypt.hash('Password1', 10),
    role,
    active: opts.active ?? true,
  }));
  return { userId: saved.id, role: saved.role };
}

describe('permisos efectivos por rol (regresión — sin overrides)', () => {
  it('ADMIN puede crear movimientos y administrar usuarios', async () => {
    const admin = await makeUser('ADMIN');
    expect(await permissions.hasPermission(admin.userId, 'ADMIN', 'movements', 'create')).toBe(true);
    expect(await permissions.hasPermission(admin.userId, 'ADMIN', 'users', 'create')).toBe(true);
    expect(await permissions.hasPermission(admin.userId, 'ADMIN', 'billing', 'remove')).toBe(true);
  });

  it('OPERATOR opera movimientos pero no administra usuarios ni borra facturación', async () => {
    const op = await makeUser('OPERATOR');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'movements', 'create')).toBe(true);
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'users', 'read')).toBe(false);
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'billing', 'remove')).toBe(false);
  });

  it('AUDITOR es de solo lectura: sin crear/editar/aprobar en ningún módulo operativo', async () => {
    const aud = await makeUser('AUDITOR');
    expect(await permissions.hasPermission(aud.userId, 'AUDITOR', 'movements', 'read')).toBe(true);
    expect(await permissions.hasPermission(aud.userId, 'AUDITOR', 'movements', 'create')).toBe(false);
    expect(await permissions.hasPermission(aud.userId, 'AUDITOR', 'movements', 'approve')).toBe(false);
  });

  it('MANAGER aprueba movimientos y ajustes, igual que ADMIN', async () => {
    const mgr = await makeUser('MANAGER');
    expect(await permissions.hasPermission(mgr.userId, 'MANAGER', 'movements', 'approve')).toBe(true);
    expect(await permissions.hasPermission(mgr.userId, 'MANAGER', 'adjustments', 'approve')).toBe(true);
  });
});

describe('último ADMIN activo — nunca puede quedar en cero', () => {
  it('con un solo ADMIN, no se puede desactivar', async () => {
    const admin = await makeUser('ADMIN');
    await expect(users.remove({ userId: 'actor', role: 'ADMIN' }, admin.userId)).rejects.toThrow(BadRequestException);
  });

  it('con un solo ADMIN, no se le puede cambiar el rol', async () => {
    const admin = await makeUser('ADMIN');
    await expect(
      users.update({ userId: 'actor', role: 'ADMIN' }, admin.userId, { role: 'OPERATOR' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('con un solo ADMIN, no se lo puede desactivar vía update({active:false})', async () => {
    const admin = await makeUser('ADMIN');
    await expect(
      users.update({ userId: 'actor', role: 'ADMIN' }, admin.userId, { active: false }),
    ).rejects.toThrow(BadRequestException);
  });

  it('con dos ADMIN activos, se puede desactivar uno y queda el otro', async () => {
    const admin1 = await makeUser('ADMIN');
    const admin2 = await makeUser('ADMIN');
    const res = await users.remove({ userId: admin2.userId, role: 'ADMIN' }, admin1.userId);
    expect(res.deactivated).toBe(true);

    const stillActive = await ds.getRepository(User).count({ where: { role: 'ADMIN', active: true } });
    expect(stillActive).toBe(1);
  });

  it('concurrencia: dos bajas simultáneas sobre los dos únicos ADMIN activos — solo una puede ganar', async () => {
    const admin1 = await makeUser('ADMIN');
    const admin2 = await makeUser('ADMIN');

    const results = await Promise.allSettled([
      users.remove({ userId: admin2.userId, role: 'ADMIN' }, admin1.userId),
      users.remove({ userId: admin1.userId, role: 'ADMIN' }, admin2.userId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const stillActive = await ds.getRepository(User).count({ where: { role: 'ADMIN', active: true } });
    expect(stillActive).toBe(1);
  });
});

describe('techo de privilegios de MANAGER', () => {
  it('crea OPERATOR y AUDITOR sin problema', async () => {
    const mgr = await makeUser('MANAGER');
    await expect(
      users.createWithPassword(mgr, 'nuevo.operador', 'Password1', 'OPERATOR'),
    ).resolves.toMatchObject({ role: 'OPERATOR' });
    await expect(
      users.createWithPassword(mgr, 'nuevo.auditor', 'Password2', 'AUDITOR'),
    ).resolves.toMatchObject({ role: 'AUDITOR' });
  });

  it('no puede crear ADMIN ni MANAGER', async () => {
    const mgr = await makeUser('MANAGER');
    await expect(users.createWithPassword(mgr, 'x.admin', 'Password1', 'ADMIN')).rejects.toThrow(ForbiddenException);
    await expect(users.createWithPassword(mgr, 'x.manager', 'Password1', 'MANAGER')).rejects.toThrow(ForbiddenException);
  });

  it('no puede editar un ADMIN existente ni otro MANAGER', async () => {
    const mgr = await makeUser('MANAGER');
    const admin = await makeUser('ADMIN');
    const otherMgr = await makeUser('MANAGER');

    await expect(users.update(mgr, admin.userId, { fullName: 'x' })).rejects.toThrow(ForbiddenException);
    await expect(users.update(mgr, otherMgr.userId, { fullName: 'x' })).rejects.toThrow(ForbiddenException);
  });

  it('no puede ascender a un OPERATOR a ADMIN o MANAGER', async () => {
    const mgr = await makeUser('MANAGER');
    const op = await makeUser('OPERATOR');
    await expect(users.update(mgr, op.userId, { role: 'ADMIN' })).rejects.toThrow(ForbiddenException);
    await expect(users.update(mgr, op.userId, { role: 'MANAGER' })).rejects.toThrow(ForbiddenException);
  });

  it('sí puede editar/desactivar/resetear contraseña de un OPERATOR', async () => {
    const mgr = await makeUser('MANAGER');
    const op = await makeUser('OPERATOR');
    await expect(users.update(mgr, op.userId, { fullName: 'Nuevo Nombre' })).resolves.toMatchObject({ fullName: 'Nuevo Nombre' });
    await expect(users.resetPassword(mgr, op.userId, 'Password9', true)).resolves.toMatchObject({ reset: true });
    await expect(users.remove(mgr, op.userId)).resolves.toMatchObject({ deactivated: true });
  });

  it('no puede otorgar un permiso que él mismo no tiene', async () => {
    const mgr = await makeUser('MANAGER');
    // billing:remove es solo-ADMIN — MANAGER no lo tiene, no puede darlo.
    await expect(
      permissions.assertCanManagePermission(mgr, 'OPERATOR', 'billing', 'remove'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('puede otorgar un permiso que él mismo sí tiene', async () => {
    const mgr = await makeUser('MANAGER');
    // movements:approve lo tiene MANAGER por rol — puede otorgárselo a un OPERATOR.
    await expect(
      permissions.assertCanManagePermission(mgr, 'OPERATOR', 'movements', 'approve'),
    ).resolves.toBeUndefined();
  });

  it('no puede tocar permisos de un ADMIN o de otro MANAGER', async () => {
    const mgr = await makeUser('MANAGER');
    await expect(permissions.assertCanManagePermission(mgr, 'ADMIN', 'reports', 'read')).rejects.toThrow(ForbiddenException);
    await expect(permissions.assertCanManagePermission(mgr, 'MANAGER', 'reports', 'read')).rejects.toThrow(ForbiddenException);
  });
});

describe('overrides ALLOW/DENY — prevalecen sobre la plantilla del rol', () => {
  it('DENY saca una acción que el rol sí daba', async () => {
    const op = await makeUser('OPERATOR');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'movements', 'create')).toBe(true);

    await permissions.setUserPermission(op.userId, 'movements', 'create', 'DENY');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'movements', 'create')).toBe(false);
  });

  it('ALLOW suma una acción que el rol no daba', async () => {
    const op = await makeUser('OPERATOR');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'billing', 'read')).toBe(false);

    await permissions.setUserPermission(op.userId, 'billing', 'read', 'ALLOW');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'billing', 'read')).toBe(true);
  });

  it('restaurar permisos del rol borra los overrides y vuelve al default', async () => {
    const op = await makeUser('OPERATOR');
    await permissions.setUserPermission(op.userId, 'movements', 'create', 'DENY');
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'movements', 'create')).toBe(false);

    await permissions.restoreRoleDefaults(op.userId);
    expect(await permissions.hasPermission(op.userId, 'OPERATOR', 'movements', 'create')).toBe(true);
    expect(await permissions.getUserOverrides(op.userId)).toHaveLength(0);
  });
});

describe('validaciones de alta', () => {
  it('username duplicado rechaza la creación', async () => {
    const admin = await makeUser('ADMIN');
    await users.createWithPassword(admin, 'duplicado', 'Password1', 'OPERATOR');
    await expect(users.createWithPassword(admin, 'duplicado', 'Password2', 'OPERATOR')).rejects.toThrow(BadRequestException);
  });

  it('la contraseña nunca se guarda en texto plano', async () => {
    const admin = await makeUser('ADMIN');
    const created = await users.createWithPassword(admin, 'plano.test', 'Password1', 'OPERATOR');
    const row = await ds.getRepository(User).findOne({ where: { id: created.id } });
    expect(row!.passwordHash).not.toBe('Password1');
    expect(await bcrypt.compare('Password1', row!.passwordHash)).toBe(true);
  });
});

describe('auditoría administrativa', () => {
  it('crear un usuario registra USER_CREATED', async () => {
    const admin = await makeUser('ADMIN');
    const created = await users.createWithPassword(admin, 'audit.create', 'Password1', 'OPERATOR');
    const log = await users.findAuditLog(created.id);
    expect(log.some((e) => e.action === 'USER_CREATED' && e.actorUserId === admin.userId)).toBe(true);
  });

  it('cambiar el rol registra ROLE_CHANGED con el antes/después', async () => {
    const admin = await makeUser('ADMIN');
    const op = await makeUser('OPERATOR');
    await users.update(admin, op.userId, { role: 'AUDITOR' });
    const log = await users.findAuditLog(op.userId);
    const entry = log.find((e) => e.action === 'ROLE_CHANGED');
    expect(entry).toMatchObject({ field: 'role', oldValue: 'OPERATOR', newValue: 'AUDITOR' });
  });

  it('resetear contraseña registra PASSWORD_RESET sin guardar la contraseña en ningún lado', async () => {
    const admin = await makeUser('ADMIN');
    const op = await makeUser('OPERATOR');
    await users.resetPassword(admin, op.userId, 'NuevaPassword1', true);
    const log = await users.findAuditLog(op.userId);
    const entry = log.find((e) => e.action === 'PASSWORD_RESET');
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toContain('NuevaPassword1');
  });
});

/**
 * Admin inicial (fresh install). La contraseña de `BOOTSTRAP_ADMIN_PASSWORD`
 * queda escrita en `.env.prod`, así que tiene que dejar de servir apenas alguien
 * entre — antes se creaba sin marca y el log sólo sugería cambiarla.
 */
describe('admin inicial — bootstrap', () => {
  const ORIGINAL = { user: process.env.BOOTSTRAP_ADMIN_USER, pass: process.env.BOOTSTRAP_ADMIN_PASSWORD };

  afterEach(() => {
    if (ORIGINAL.user === undefined) delete process.env.BOOTSTRAP_ADMIN_USER;
    else process.env.BOOTSTRAP_ADMIN_USER = ORIGINAL.user;
    if (ORIGINAL.pass === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    else process.env.BOOTSTRAP_ADMIN_PASSWORD = ORIGINAL.pass;
  });

  it('con BOOTSTRAP_ADMIN_PASSWORD exige el cambio en el primer inicio de sesión', async () => {
    process.env.BOOTSTRAP_ADMIN_USER = 'rl.admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'una-clave-asignada-larga';

    await users.onApplicationBootstrap();

    const admin = await ds.getRepository(User).findOne({ where: { username: 'rl.admin' } });
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('ADMIN');
    expect(admin!.mustChangePassword).toBe(true);
  });

  it('el fallback de desarrollo no lo exige — admin123 es una decisión conocida', async () => {
    delete process.env.BOOTSTRAP_ADMIN_USER;
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;

    await users.onApplicationBootstrap();

    const admin = await ds.getRepository(User).findOne({ where: { username: 'admin' } });
    expect(admin!.mustChangePassword).toBe(false);
  });

  it('no hace nada si ya hay usuarios: no pisa una instalación en uso', async () => {
    await makeUser('OPERATOR', { username: 'ya.existe' });
    process.env.BOOTSTRAP_ADMIN_USER = 'rl.admin';
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'una-clave-asignada-larga';

    await users.onApplicationBootstrap();

    expect(await ds.getRepository(User).findOne({ where: { username: 'rl.admin' } })).toBeNull();
  });
});
