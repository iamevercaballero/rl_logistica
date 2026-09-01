import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transport, TransportDriver } from './entities/transport.entity';
import { CreateTransportDto } from './dto/create-transport.dto';
import { RegisterInspectionDto, UpdateTransportDto } from './dto/update-transport.dto';
import { LogisticsDocument } from '../movements/entities/logistics-document.entity';
import { UploadsService } from '../uploads/uploads.service';

/** Transport con choferes deserializados (lo que consume el frontend). */
type TransportView = Omit<Transport, 'driversJson'> & { drivers: TransportDriver[] };

@Injectable()
export class TransportsService {
  private readonly logger = new Logger(TransportsService.name);

  constructor(
    @InjectRepository(Transport)
    private readonly repo: Repository<Transport>,
    private readonly dataSource: DataSource,
    private readonly uploads: UploadsService,
  ) {}

  /**
   * Registra un evento de flota sin poder tumbar el proceso.
   *
   * Antes cada llamada iba con `void` y sin captura, y una promesa rechazada sin
   * manejar termina el proceso en Node 20 — un fallo escribiendo la bitácora de
   * un vehículo se llevaba puesta toda petición en vuelo.
   *
   * No va en transacción, a diferencia de inventario y ajustes: esto es el
   * catálogo de la flota, no el histórico que hay que poder reconstruir a diez
   * años. Perder un evento acá se registra y se sigue; ahí no.
   */
  private async registrar(
    entityId: string,
    eventType: 'CREADO' | 'EDITADO' | 'INSPECCION',
    description: string,
    userId?: string,
  ): Promise<void> {
    try {
      await this.uploads.log({ entityType: 'VEHICLE', entityId, eventType, description, userId });
    } catch (error) {
      this.logger.error(`No se pudo registrar "${description}" del vehículo ${entityId}: ${String(error)}`);
    }
  }

  private toView(t: Transport): TransportView {
    const { driversJson, ...rest } = t;
    let drivers: TransportDriver[] = [];
    if (driversJson) {
      try {
        const parsed = JSON.parse(driversJson) as TransportDriver[];
        if (Array.isArray(parsed)) drivers = parsed;
      } catch {
        drivers = [];
      }
    }
    return { ...rest, drivers };
  }

  async create(dto: CreateTransportDto, userId?: string) {
    const { drivers, ...fields } = dto;

    // La patente identifica al vehículo: los remitos se vinculan por ella, así que
    // duplicarla mezcla el historial de viajes de dos vehículos distintos.
    const plate = fields.plate.trim().toUpperCase();
    const existing = await this.repo.findOne({ where: { plate } });
    if (existing) {
      throw new BadRequestException(`Ya existe un vehículo con la patente ${plate}`);
    }

    const transport = this.repo.create({
      ...fields,
      plate,
      status: dto.status ?? 'DISPONIBLE',
      driversJson: drivers && drivers.length > 0 ? JSON.stringify(drivers) : null,
    });
    const saved = await this.repo.save(transport);

    await this.registrar(saved.id, 'CREADO', `Vehículo ${saved.plate} (${saved.type}) registrado en la flota`, userId);

    return this.toView(saved);
  }

  async findAll() {
    const list = await this.repo.find({ order: { plate: 'ASC' } });
    return list.map((t) => this.toView(t));
  }

  async findOne(id: string) {
    const transport = await this.repo.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transporte no encontrado');
    return this.toView(transport);
  }

  async update(id: string, dto: UpdateTransportDto, userId?: string) {
    const transport = await this.repo.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transporte no encontrado');

    const oldStatus = transport.status;
    const { drivers, ...fields } = dto;
    Object.assign(transport, fields);
    if (drivers !== undefined) {
      transport.driversJson = drivers.length > 0 ? JSON.stringify(drivers) : null;
    }
    const saved = await this.repo.save(transport);

    if (dto.status && dto.status !== oldStatus) {
      await this.registrar(id, 'EDITADO', `Estado operativo: ${oldStatus} → ${dto.status}`, userId);
    }

    return this.toView(saved);
  }

  /**
   * Historial de entradas/salidas del vehículo: remitos (RLNE/RLNS) cuya
   * patente coincide con la del vehículo, más un resumen.
   */
  async history(id: string) {
    const transport = await this.findOne(id);

    const documents = await this.dataSource
      .getRepository(LogisticsDocument)
      .createQueryBuilder('doc')
      .where('doc."vehiclePlate" ILIKE :plate', { plate: transport.plate.trim() })
      .orderBy('doc.date', 'DESC')
      .addOrderBy('doc.createdAt', 'DESC')
      .limit(100)
      .getMany();

    const entries = documents.filter((d) => d.type === 'ENTRY').length;
    const exits = documents.filter((d) => d.type === 'EXIT').length;

    return {
      transport,
      documents,
      summary: {
        totalTrips: documents.length,
        entries,
        exits,
        lastTrip: documents.length > 0 ? documents[0].createdAt : null,
      },
    };
  }

  /** Registra una inspección en la bitácora del vehículo (y opcionalmente cambia el estado). */
  async inspect(id: string, dto: RegisterInspectionDto, userId: string) {
    const transport = await this.repo.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transporte no encontrado');

    const labels: Record<string, string> = {
      APROBADA: 'aprobada ✓',
      CON_OBSERVACIONES: 'con observaciones',
      RECHAZADA: 'rechazada',
    };
    await this.registrar(
      id, 'INSPECCION',
      `Inspección ${labels[dto.result] ?? dto.result}${dto.notes?.trim() ? ` — ${dto.notes.trim()}` : ''}`,
      userId,
    );

    if (dto.setStatus && dto.setStatus !== transport.status) {
      const oldStatus = transport.status;
      transport.status = dto.setStatus;
      await this.repo.save(transport);
      await this.registrar(id, 'EDITADO', `Estado operativo: ${oldStatus} → ${dto.setStatus} (por inspección)`, userId);
    }

    return this.toView(transport);
  }

  async remove(id: string, userId?: string) {
    const transport = await this.repo.findOne({ where: { id } });
    if (!transport) throw new NotFoundException('Transporte no encontrado');
    await this.repo.remove(transport);

    await this.registrar(id, 'EDITADO', `Vehículo ${transport.plate} eliminado de la flota`, userId);

    return { deleted: true };
  }
}
