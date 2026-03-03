import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  findAll() {
    return this.userRepo.find({
      select: ['id', 'username', 'role', 'active'],
    });
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
  }

  async createWithPassword(username: string, password: string, role: UserRole = 'OPERATOR') {
    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) throw new BadRequestException('Username ya existe');

    const passwordHash = await bcrypt.hash(password, 10);

    const user = this.userRepo.create({
      username,
      passwordHash,
      role,
      active: true,
    });

    const saved = await this.userRepo.save(user);

    // no devolver hash
    return {
      id: saved.id,
      username: saved.username,
      role: saved.role,
      active: saved.active,
    };
  }
}
