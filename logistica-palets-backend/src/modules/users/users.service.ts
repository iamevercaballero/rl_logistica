import { Injectable, BadRequestException, ForbiddenException, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';
import { UserAuditLog, UserAuditAction } from './entities/user-audit-log.entity';

/** Roles que un MANAGER puede administrar. Ni ADMIN ni MANAGER — nunca a sí mismo ni a un par. */
const MANAGER_MANAGEABLE_ROLES: UserRole[] = ['OPERATOR', 'AUDITOR'];

export type ActingUser = { userId: string; role: UserRole };

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserAuditLog)
    private readonly auditRepo: Repository<UserAuditLog>,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.userRepo.count();
    if (count > 0) return;

    const isProd = process.env.NODE_ENV === 'production';
    const envUser = process.env.BOOTSTRAP_ADMIN_USER;
    const envPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

    // En producción NO se permite el admin por defecto: exigir credenciales
    // fuertes definidas explícitamente. Sólo aplica en fresh install (tabla
    // vacía); en restarts de una DB ya poblada este bloque no se ejecuta.
    if (isProd) {
      if (!envUser || !envPassword) {
        throw new Error(
          'Fresh install en producción: definí BOOTSTRAP_ADMIN_USER y ' +
            'BOOTSTRAP_ADMIN_PASSWORD antes de arrancar.',
        );
      }
      if (envPassword.length < 12) {
        throw new Error(
          'BOOTSTRAP_ADMIN_PASSWORD debe tener al menos 12 caracteres en producción.',
        );
      }
      if (envPassword === 'admin123') {
        throw new Error('BOOTSTRAP_ADMIN_PASSWORD no puede ser el valor por defecto.');
      }
    }

    const username = envUser ?? 'admin';
    const password = envPassword ?? 'admin123'; // 'admin123' sólo en dev/test
    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save(
      this.userRepo.create({ username, passwordHash, role: 'ADMIN', active: true, fullName: 'Administrador' }),
    );
    this.logger.warn(`Fresh install: usuario admin creado (usuario: ${username}). Cambiá la contraseña.`);
  }

  findAll() {
    return this.userRepo.find({
      select: ['id', 'username', 'fullName', 'role', 'active'],
      order: { username: 'ASC' },
    });
  }

  findActive() {
    return this.userRepo.find({
      where: { active: true },
      select: ['id', 'username', 'fullName', 'role'],
      order: { username: 'ASC' },
    });
  }

  async findOne(id: string) {
    const user = await this.userRepo.findOne({
      where: { id },
      select: ['id', 'username', 'fullName', 'role', 'active', 'createdAt', 'updatedAt', 'lastLoginAt', 'mustChangePassword'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
  }

  /** Se llama desde `AuthService.login` tras una autenticación exitosa. */
  async touchLastLogin(id: string): Promise<void> {
    await this.userRepo.update({ id }, { lastLoginAt: new Date() });
  }

  // ── Techo de privilegios de MANAGER ───────────────────────────────────────

  /**
   * ¿Puede `actor` administrar (crear/editar/desactivar/resetear) un usuario
   * con este rol? ADMIN no tiene techo. MANAGER solo administra OPERATOR y
   * AUDITOR — nunca ADMIN, nunca otro MANAGER, nunca a sí mismo por esta vía.
   */
  assertManagerCeiling(actor: ActingUser, targetRole: UserRole): void {
    if (actor.role === 'ADMIN') return;
    if (actor.role !== 'MANAGER') {
      throw new ForbiddenException('No tenés permiso para administrar usuarios.');
    }
    if (!MANAGER_MANAGEABLE_ROLES.includes(targetRole)) {
      throw new ForbiddenException('Un MANAGER no puede administrar usuarios ADMIN o MANAGER.');
    }
  }

  async writeAudit(
    actorUserId: string,
    targetUserId: string,
    action: UserAuditAction,
    field?: string,
    oldValue?: string | null,
    newValue?: string | null,
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({ actorUserId, targetUserId, action, field: field ?? null, oldValue: oldValue ?? null, newValue: newValue ?? null }),
    );
  }

  findAuditLog(targetUserId: string) {
    return this.auditRepo.find({ where: { targetUserId }, order: { createdAt: 'DESC' } });
  }

  // ── Alta ───────────────────────────────────────────────────────────────────

  async createWithPassword(
    actor: ActingUser,
    username: string,
    password: string,
    role: UserRole = 'OPERATOR',
    fullName?: string,
    mustChangePassword = false,
  ) {
    this.assertManagerCeiling(actor, role);

    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) throw new BadRequestException('Username ya existe');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.userRepo.create({
      username,
      passwordHash,
      role,
      active: true,
      fullName: fullName ?? null,
      mustChangePassword,
    });
    const saved = await this.userRepo.save(user);
    await this.writeAudit(actor.userId, saved.id, 'USER_CREATED', 'role', null, role);
    return this.findOne(saved.id);
  }

  // ── Edición ──────────────────────────────────────────────────────────────

  async update(actor: ActingUser, id: string, dto: { username?: string; password?: string; role?: string; fullName?: string; active?: boolean }) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const user = await repo.findOne({ where: { id } });
      if (!user) throw new NotFoundException('Usuario no encontrado');

      this.assertManagerCeiling(actor, user.role);
      if (dto.role) this.assertManagerCeiling(actor, dto.role as UserRole);

      // Un usuario deja de ser "ADMIN activo" si se le cambia el rol o se lo
      // desactiva — las dos formas de vaciar el sistema de administradores.
      const losingActiveAdmin =
        user.role === 'ADMIN' &&
        user.active &&
        ((dto.role && dto.role !== 'ADMIN') || dto.active === false);

      if (losingActiveAdmin) {
        const remainingAdmins = await repo
          .createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.role = :role', { role: 'ADMIN' })
          .andWhere('u.active = true')
          .getMany();
        if (remainingAdmins.length <= 1) {
          throw new BadRequestException(
            dto.active === false
              ? 'No se puede desactivar el último usuario ADMIN activo.'
              : 'No se puede cambiar el rol del último usuario ADMIN activo.',
          );
        }
      }

      if (dto.username && dto.username !== user.username) {
        const clash = await repo.findOne({ where: { username: dto.username } });
        if (clash && clash.id !== id) throw new BadRequestException('Username ya existe');
        user.username = dto.username;
      }
      if (dto.role && dto.role !== user.role) {
        const oldRole = user.role;
        user.role = dto.role as UserRole;
        await this.writeAudit(actor.userId, id, 'ROLE_CHANGED', 'role', oldRole, user.role);
      }
      if (dto.fullName !== undefined && dto.fullName !== user.fullName) {
        await this.writeAudit(actor.userId, id, 'USER_UPDATED', 'fullName', user.fullName ?? null, dto.fullName);
        user.fullName = dto.fullName;
      }
      if (dto.active !== undefined && dto.active !== user.active) {
        user.active = dto.active;
        await this.writeAudit(actor.userId, id, dto.active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', 'active', String(!dto.active), String(dto.active));
      }
      if (dto.password) {
        user.passwordHash = await bcrypt.hash(dto.password, 10);
        user.passwordChangedAt = new Date();
        await this.writeAudit(actor.userId, id, 'PASSWORD_RESET');
      }

      const saved = await repo.save(user);
      return {
        id: saved.id, username: saved.username, fullName: saved.fullName,
        role: saved.role, active: saved.active,
      };
    });
  }

  /**
   * Baja lógica. `movements.createdById` y `document_events.userId` son columnas uuid
   * sin FK: un DELETE físico dejaría el histórico sin autor y rompería la trazabilidad
   * de quién registró cada movimiento.
   */
  async remove(actor: ActingUser, id: string) {
    if (actor.userId === id) {
      throw new BadRequestException('No podés desactivar tu propio usuario.');
    }
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const user = await repo.findOne({ where: { id } });
      if (!user) throw new NotFoundException('Usuario no encontrado');

      this.assertManagerCeiling(actor, user.role);

      if (user.role === 'ADMIN' && user.active) {
        const remainingAdmins = await repo
          .createQueryBuilder('u')
          .setLock('pessimistic_write')
          .where('u.role = :role', { role: 'ADMIN' })
          .andWhere('u.active = true')
          .getMany();
        if (remainingAdmins.length <= 1) {
          throw new BadRequestException('No se puede desactivar el último usuario ADMIN activo.');
        }
      }

      user.active = false;
      await repo.save(user);
      await this.writeAudit(actor.userId, id, 'USER_DEACTIVATED', 'active', 'true', 'false');
      return { deleted: true, deactivated: true, id: user.id };
    });
  }

  // ── Seguridad ────────────────────────────────────────────────────────────

  async resetPassword(actor: ActingUser, id: string, newPassword: string, mustChangePassword = true) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    this.assertManagerCeiling(actor, user.role);

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = mustChangePassword;
    await this.userRepo.save(user);
    await this.writeAudit(actor.userId, id, 'PASSWORD_RESET');
    return { reset: true };
  }

  /**
   * "Cerrar sesiones": invalida cualquier JWT ya emitido para este usuario sin
   * tocar la contraseña — `JwtStrategy` rechaza un token emitido antes de
   * `passwordChangedAt`, así que alcanza con adelantar esa marca.
   */
  async closeSessions(actor: ActingUser, id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    this.assertManagerCeiling(actor, user.role);

    user.passwordChangedAt = new Date();
    await this.userRepo.save(user);
    await this.writeAudit(actor.userId, id, 'SESSIONS_CLOSED');
    return { closed: true };
  }

  /** Self-service: el propio usuario cambia su contraseña (ej. tras `mustChangePassword`). */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('La contraseña actual no es correcta.');

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordChangedAt = new Date();
    user.mustChangePassword = false;
    await this.userRepo.save(user);
    await this.writeAudit(userId, userId, 'PASSWORD_RESET');
    return { changed: true };
  }
}
