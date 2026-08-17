import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { CreateDestinationDto, UpdateDestinationDto } from './dto/destination.dto';
import { Destination } from './entities/destination.entity';

@Injectable()
export class DestinationsService {
  constructor(
    @InjectRepository(Destination)
    private readonly destinationRepo: Repository<Destination>,
  ) {}

  findAll(search?: string, includeInactive = false) {
    const term = search?.trim();
    const where = {
      ...(includeInactive ? {} : { active: true }),
      ...(term ? { name: ILike(`%${term}%`) } : {}),
    };
    return this.destinationRepo.find({ where, order: { name: 'ASC' }, take: 200 });
  }

  async findOne(id: string) {
    const destination = await this.destinationRepo.findOne({ where: { id } });
    if (!destination) throw new NotFoundException('Destino no encontrado');
    return destination;
  }

  private findByNormalizedName(name: string) {
    return this.destinationRepo
      .createQueryBuilder('destination')
      .where('LOWER(TRIM(destination.name)) = LOWER(:name)', { name: name.trim() })
      .getOne();
  }

  async create(dto: CreateDestinationDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('El nombre del destino es obligatorio');

    const existing = await this.findByNormalizedName(name);
    if (existing) throw new BadRequestException(`Ya existe el destino "${existing.name}"`);

    return this.destinationRepo.save(
      this.destinationRepo.create({
        name,
        notes: dto.notes?.trim() || null,
        active: dto.active ?? true,
      }),
    );
  }

  async update(id: string, dto: UpdateDestinationDto) {
    const destination = await this.findOne(id);
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre del destino es obligatorio');
      const clash = await this.findByNormalizedName(name);
      if (clash && clash.id !== id) {
        throw new BadRequestException(`Ya existe el destino "${clash.name}"`);
      }
      destination.name = name;
    }
    if (dto.notes !== undefined) destination.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) destination.active = dto.active;
    return this.destinationRepo.save(destination);
  }

  async deactivate(id: string) {
    const destination = await this.findOne(id);
    destination.active = false;
    return this.destinationRepo.save(destination);
  }
}
