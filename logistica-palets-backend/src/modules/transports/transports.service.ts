import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transport } from './entities/transport.entity';
import { CreateTransportDto } from './dto/create-transport.dto';
import { UpdateTransportDto } from './dto/update-transport.dto';

@Injectable()
export class TransportsService {
  constructor(
    @InjectRepository(Transport)
    private readonly repo: Repository<Transport>,
  ) {}

  create(dto: CreateTransportDto) {
    const transport = this.repo.create(dto);
    return this.repo.save(transport);
  }

  findAll() {
    return this.repo.find();
  }

  async findOne(id: string) {
    const transport = await this.repo.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transporte no encontrado');
    return transport;
  }

  async update(id: string, dto: UpdateTransportDto) {
    const transport = await this.findOne(id);
    Object.assign(transport, dto);
    return this.repo.save(transport);
  }

  async remove(id: string) {
    const transport = await this.findOne(id);
    await this.repo.remove(transport);
    return { deleted: true };
  }
}
