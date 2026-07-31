import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { Product } from './entities/product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

export interface BulkImportRowError {
  row: number;
  code?: string;
  description?: string;
  reason: string;
}

export interface BulkImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: BulkImportRowError[];
}

/** Alias de encabezados aceptados por columna, ya normalizados (sin tildes, minúsculas). */
const HEADER_ALIASES: Record<'code' | 'description' | 'unitOfMeasure' | 'stackable', string[]> = {
  code: ['codigo', 'cod', 'material', 'codigo material', 'codigo de material'],
  description: ['descripcion', 'desc', 'descripcion material'],
  unitOfMeasure: ['um', 'u.m.', 'unidad', 'unidad de medida'],
  stackable: ['apilable', 'stackable'],
};

const DIACRITICS_PATTERN = new RegExp('[̀-ͯ]', 'g');

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .trim()
    .toLowerCase();
}

function mapRow(raw: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(raw)) {
    const norm = normalizeHeader(header);
    const field = (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).find((key) =>
      HEADER_ALIASES[key].includes(norm),
    );
    if (field) mapped[field] = value;
  }
  return mapped;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async create(dto: CreateProductDto) {
    await this.ensureCodeAvailable(dto.code);
    const product = this.productRepo.create({
      ...dto,
      code: dto.code.trim().toUpperCase(),
      description: dto.description.trim(),
      unitOfMeasure: dto.unitOfMeasure?.trim().toUpperCase(),
    });
    return this.productRepo.save(product);
  }

  findAll(search?: string) {
    if (search?.trim()) {
      const q = `%${search.trim()}%`;
      return this.productRepo.find({
        where: [{ code: ILike(q) }, { description: ILike(q) }],
        order: { code: 'ASC' },
        take: 50,
      });
    }
    return this.productRepo.find({ order: { code: 'ASC' } });
  }

  async findOne(id: string) {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Material no encontrado');
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.findOne(id);

    if (dto.code && dto.code.trim().toUpperCase() !== product.code) {
      await this.ensureCodeAvailable(dto.code, id);
    }

    Object.assign(product, {
      ...dto,
      code: dto.code ? dto.code.trim().toUpperCase() : product.code,
      description: dto.description ? dto.description.trim() : product.description,
      unitOfMeasure: dto.unitOfMeasure ? dto.unitOfMeasure.trim().toUpperCase() : product.unitOfMeasure,
    });

    return this.productRepo.save(product);
  }

  /**
   * Baja lógica cuando el material tiene historia. El DELETE físico rompía la FK de
   * `lots.productId` con un 500 sin explicación, y hubiera dejado sin material a los
   * movimientos ya registrados (`movements.productId` no tiene FK).
   */
  async remove(id: string) {
    const product = await this.findOne(id);

    const [{ lots, movements, stock }] = (await this.productRepo.query(
      `SELECT
         (SELECT COUNT(*) FROM lots WHERE "productId" = $1)::int              AS lots,
         (SELECT COUNT(*) FROM movements WHERE "productId" = $1)::int         AS movements,
         (SELECT COALESCE(SUM("currentQuantity"), 0) FROM stocks
           WHERE "productId" = $1)::int                                       AS stock`,
      [id],
    )) as Array<{ lots: number; movements: number; stock: number }>;

    if (stock !== 0) {
      throw new BadRequestException(
        `No se puede eliminar el material ${product.code}: tiene ${stock} unidad(es) en stock. ` +
        `Despachá o ajustá el stock antes de darlo de baja.`,
      );
    }

    if (lots > 0 || movements > 0) {
      product.active = false;
      await this.productRepo.save(product);
      return {
        deleted: true,
        deactivated: true,
        id: product.id,
        reason: `El material tiene ${lots} lote(s) y ${movements} movimiento(s): se desactivó en lugar de eliminarse para preservar el histórico.`,
      };
    }

    await this.productRepo.remove(product);
    return { deleted: true, deactivated: false, id };
  }

  /** Productos con stock por debajo del mínimo configurado */
  async findBelowMinimum() {
    return this.productRepo
      .createQueryBuilder('p')
      .innerJoin('stocks', 's', 's."productId" = p.id')
      .where('p."stockMinimo" IS NOT NULL')
      .groupBy('p.id')
      .having('SUM(s."currentQuantity") < p."stockMinimo"')
      .select(['p.id AS id', 'p.code AS code', 'p.description AS description',
               'p."stockMinimo" AS "stockMinimo"', 'SUM(s."currentQuantity") AS "stockActual"'])
      .getRawMany();
  }

  private async ensureCodeAvailable(code: string, excludeId?: string) {
    const existing = await this.productRepo.findOne({ where: { code: code.trim().toUpperCase() } });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException('Ya existe un material con ese código');
    }
  }

  /**
   * Carga masiva de materiales desde un archivo Excel/CSV.
   * Filas con datos inválidos, incompletos o códigos duplicados se omiten y se
   * reportan en `errors`; el resto se inserta en un solo lote.
   */
  async bulkImport(buffer: Buffer): Promise<BulkImportResult> {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('No se pudo leer el archivo. Verificá que sea un Excel (.xlsx/.xls) o CSV válido.');
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new BadRequestException('El archivo no contiene hojas con datos.');

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
    if (rows.length === 0) throw new BadRequestException('El archivo no contiene filas de datos.');

    const existingCodes = new Set((await this.productRepo.find({ select: ['code'] })).map((p) => p.code));
    const seenCodes = new Set<string>();
    const errors: BulkImportRowError[] = [];
    const candidates: Partial<Product>[] = [];

    rows.forEach((raw, index) => {
      const rowNumber = index + 2; // fila 1 = encabezado
      const mapped = mapRow(raw);

      const codeRaw = String(mapped.code ?? '').trim();
      if (!codeRaw) {
        errors.push({ row: rowNumber, reason: 'Código vacío' });
        return;
      }
      if (!/\d/.test(codeRaw)) {
        errors.push({ row: rowNumber, code: codeRaw, reason: 'Código inválido (no contiene dígitos)' });
        return;
      }
      const code = codeRaw.toUpperCase();

      const descRaw = String(mapped.description ?? '').trim();
      if (!descRaw) {
        errors.push({ row: rowNumber, code, reason: 'Descripción vacía' });
        return;
      }
      const description = descRaw.toUpperCase().replace(/\s+/g, ' ');

      const umRaw = String(mapped.unitOfMeasure ?? '').trim();
      if (!umRaw) {
        errors.push({ row: rowNumber, code, description, reason: 'Unidad de medida vacía' });
        return;
      }
      const unitOfMeasure = umRaw.toUpperCase();

      if (seenCodes.has(code)) {
        errors.push({ row: rowNumber, code, description, reason: 'Código duplicado dentro del archivo' });
        return;
      }
      if (existingCodes.has(code)) {
        errors.push({ row: rowNumber, code, description, reason: 'Ya existe un material con este código' });
        return;
      }
      seenCodes.add(code);

      const apilableRaw = String(mapped.stackable ?? '').trim().toUpperCase();
      const stackable = apilableRaw !== 'NO';

      const product: Partial<Product> = { code, description, unitOfMeasure, stackable };
      if (!stackable) product.canReceiveWeightOnTop = false;
      candidates.push(product);
    });

    if (candidates.length > 0) {
      const entities = candidates.map((c) => this.productRepo.create(c));
      await this.productRepo.save(entities);
    }

    return {
      totalRows: rows.length,
      imported: candidates.length,
      skipped: errors.length,
      errors,
    };
  }
}
