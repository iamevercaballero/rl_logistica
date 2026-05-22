import { Injectable, BadRequestException, NotFoundException, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.userRepo.count();
    if (count > 0) return;

    const username = process.env.BOOTSTRAP_ADMIN_USER ?? 'admin';
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'admin123';
    const passwordHash = await bcrypt.hash(password, 10);
    await this.userRepo.save(
      this.userRepo.create({ username, passwordHash, role: 'ADMIN', active: true, fullName: 'Administrador' }),
    );
    this.logger.warn(`Fresh install: usuario admin creado (usuario: ${username}). Cambiá la contraseña.`);
  }

  findAll() {
    return this.userRepo.find({
      select: ['id', 'username', 'fullName', 'role', 'active'],
    });
  }

  findActive() {
    return this.userRepo.find({
      where: { active: true },
      select: ['id', 'username', 'fullName', 'role'],
      order: { username: 'ASC' },
    });
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
  }

  async createWithPassword(username: string, password: string, role: UserRole = 'OPERATOR', fullName?: string) {
    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) throw new BadRequestException('Username ya existe');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.userRepo.create({ username, passwordHash, role, active: true, fullName: fullName ?? null });
    const saved = await this.userRepo.save(user);
    return { id: saved.id, username: saved.username, fullName: saved.fullName, role: saved.role, active: saved.active };
  }

  async update(id: string, dto: { username?: string; password?: string; role?: string; fullName?: string; active?: boolean }) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (dto.username) user.username = dto.username;
    if (dto.role) user.role = dto.role as UserRole;
    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.active !== undefined) user.active = dto.active;
    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, 10);

    const saved = await this.userRepo.save(user);
    return { id: saved.id, username: saved.username, fullName: saved.fullName, role: saved.role, active: saved.active };
  }

  async remove(id: string) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    await this.userRepo.remove(user);
    return { deleted: true };
  }
}
