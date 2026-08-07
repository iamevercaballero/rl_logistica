import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    private readonly dataSource: DataSource,
  ) {}

  /** Listado para el selector: ordenados por nombre, solo activos salvo que se pidan todos. */
  findAll(search?: string, includeInactive = false) {
    const term = search?.trim();
    // El filtro de activo va dentro de CADA rama del OR: un `where` en array
    // son condiciones alternativas, así que ponerlo afuera no lo aplicaría.
    const activeFilter = includeInactive ? {} : { active: true };

    const where = term
      ? [
          { ...activeFilter, name: ILike(`%${term}%`) },
          { ...activeFilter, ruc: ILike(`%${term}%`) },
        ]
      : activeFilter;

    return this.supplierRepo.find({ where, order: { name: 'ASC' }, take: 200 });
  }

  async findOne(id: string) {
    const supplier = await this.supplierRepo.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  async create(dto: CreateSupplierDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('El nombre del proveedor es obligatorio');

    // Case-insensitive: "Cervepar" y "CERVEPAR" son el mismo proveedor, y dos
    // filas distintas partirían los reportes por proveedor en dos.
    const existing = await this.supplierRepo.findOne({ where: { name: ILike(name) } });
    if (existing) {
      throw new BadRequestException(`Ya existe el proveedor "${existing.name}"`);
    }

    return this.supplierRepo.save(
      this.supplierRepo.create({
        name,
        ruc: dto.ruc?.trim() || null,
        notes: dto.notes?.trim() || null,
        active: dto.active ?? true,
      }),
    );
  }

  async update(id: string, dto: UpdateSupplierDto) {
    const supplier = await this.findOne(id);

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre del proveedor es obligatorio');
      const clash = await this.supplierRepo.findOne({ where: { name: ILike(name) } });
      if (clash && clash.id !== id) {
        throw new BadRequestException(`Ya existe el proveedor "${clash.name}"`);
      }
      supplier.name = name;
    }
    if (dto.ruc !== undefined) supplier.ruc = dto.ruc?.trim() || null;
    if (dto.notes !== undefined) supplier.notes = dto.notes?.trim() || null;
    if (dto.active !== undefined) supplier.active = dto.active;

    return this.supplierRepo.save(supplier);
  }

  /**
   * Baja lógica: los remitos guardan el nombre copiado, así que desactivar no
   * rompe el histórico — pero borrar la fila sí perdería el RUC y la ficha.
   * Por eso no hay `delete` duro.
   */
  async deactivate(id: string) {
    const supplier = await this.findOne(id);
    supplier.active = false;
    return this.supplierRepo.save(supplier);
  }

  /** Cuántos remitos referencian a este proveedor (por el nombre copiado). */
  async usage(id: string) {
    const supplier = await this.findOne(id);
    const [{ documents }] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS documents FROM logistics_documents WHERE supplier = $1`,
      [supplier.name],
    )) as Array<{ documents: number }>;
    return { supplier, documents };
  }
}
