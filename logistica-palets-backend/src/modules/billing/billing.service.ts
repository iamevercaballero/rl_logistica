import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { QueryFacturaDto } from './dto/query-factura.dto';
import { Cliente } from './entities/cliente.entity';
import { Factura } from './entities/factura.entity';
import { ItemFactura } from './entities/item-factura.entity';
import { XmlGeneratorService, EmisorConfig } from './xml-generator.service';
import { SifenService } from './sifen.service';

@Injectable()
export class BillingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(Factura) private readonly facturaRepo: Repository<Factura>,
    private readonly xmlGenerator: XmlGeneratorService,
    private readonly sifenService: SifenService,
    private readonly config: ConfigService,
  ) {}

  // ─── Clientes ────────────────────────────────────────────────────────────────

  async crearCliente(dto: CreateClienteDto): Promise<Cliente> {
    const existe = await this.clienteRepo.findOne({ where: { ruc: dto.ruc } });
    if (existe) throw new BadRequestException(`RUC ${dto.ruc} ya está registrado`);
    const cliente = this.clienteRepo.create(dto);
    return this.clienteRepo.save(cliente);
  }

  async listarClientes(): Promise<Cliente[]> {
    return this.clienteRepo.find({ where: { activo: true }, order: { razonSocial: 'ASC' } });
  }

  async obtenerCliente(id: string): Promise<Cliente> {
    const c = await this.clienteRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return c;
  }

  async actualizarCliente(id: string, dto: Partial<CreateClienteDto>): Promise<Cliente> {
    const c = await this.obtenerCliente(id);
    Object.assign(c, dto);
    return this.clienteRepo.save(c);
  }

  async desactivarCliente(id: string): Promise<void> {
    const c = await this.obtenerCliente(id);
    c.activo = false;
    await this.clienteRepo.save(c);
  }

  // ─── Facturas ────────────────────────────────────────────────────────────────

  async crearFactura(dto: CreateFacturaDto, userId: string): Promise<Factura> {
    const cliente = await this.clienteRepo.findOne({ where: { id: dto.clienteId, activo: true } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado o inactivo');
    if (!dto.items?.length) throw new BadRequestException('La factura debe tener al menos un ítem');

    return this.dataSource.transaction(async (manager) => {
      const timbrado = this.config.get<string>('FACTURA_TIMBRADO', '12345678');
      const vigencia = this.config.get<string>('FACTURA_VIGENCIA', new Date(Date.now() + 365 * 86400000).toISOString());
      const establecimiento = this.config.get<string>('FACTURA_ESTABLECIMIENTO', '001');
      const puntoExpedicion = this.config.get<string>('FACTURA_PUNTO_EXPEDICION', '001');

      // Siguiente número de documento (por establecimiento + punto)
      const ultimo = await manager
        .createQueryBuilder(Factura, 'f')
        .where('f.establecimiento = :est AND f.puntoExpedicion = :pun', { est: establecimiento, pun: puntoExpedicion })
        .orderBy('f.numeroDocumento', 'DESC')
        .getOne();
      const numeroDocumento = (ultimo?.numeroDocumento ?? 0) + 1;

      const factura = manager.create(Factura, {
        tipoDE: dto.tipoDE,
        clienteId: dto.clienteId,
        cliente,
        fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
        condicionPago: dto.condicionPago,
        moneda: dto.moneda ?? 'PYG',
        establecimiento,
        puntoExpedicion,
        numeroDocumento,
        timbrado,
        fechaVigenciaTimbrado: new Date(vigencia),
        movimientoId: dto.movimientoId,
        observaciones: dto.observaciones,
        estado: 'BORRADOR',
        createdById: userId,
      });

      const items = dto.items.map((i, idx) => this.calcularItem(manager.create(ItemFactura, {
        orden: idx + 1,
        codigo: i.codigo,
        descripcion: i.descripcion,
        unidadMedida: i.unidadMedida ?? 'UNI',
        cantidad: Number(i.cantidad),
        precioUnitario: Number(i.precioUnitario),
        descuentoPorcentaje: Number(i.descuentoPorcentaje ?? 0),
        afectacionIVA: i.afectacionIVA,
      })));

      this.calcularTotales(factura, items);
      const saved = await manager.save(Factura, factura);
      items.forEach((it) => (it.facturaId = saved.id));
      await manager.save(ItemFactura, items);
      saved.items = items;
      return saved;
    });
  }

  async listarFacturas(query: QueryFacturaDto): Promise<{ data: Factura[]; meta: any }> {
    const qb = this.facturaRepo.createQueryBuilder('f')
      .leftJoinAndSelect('f.cliente', 'c')
      .leftJoinAndSelect('f.items', 'i')
      .orderBy('f.createdAt', 'DESC');

    if (query.estado) qb.andWhere('f.estado = :estado', { estado: query.estado });
    if (query.clienteId) qb.andWhere('f.clienteId = :clienteId', { clienteId: query.clienteId });
    if (query.desde) qb.andWhere('f.fecha >= :desde', { desde: query.desde });
    if (query.hasta) qb.andWhere('f.fecha <= :hasta', { hasta: query.hasta });
    if (query.buscar) {
      qb.andWhere(
        '(c.razonSocial ILIKE :q OR c.ruc ILIKE :q OR CAST(f.numeroDocumento AS TEXT) ILIKE :q)',
        { q: `%${query.buscar}%` },
      );
    }

    const total = await qb.getCount();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    qb.skip((page - 1) * limit).take(limit);
    const data = await qb.getMany();

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async obtenerFactura(id: string): Promise<Factura> {
    const f = await this.facturaRepo.findOne({
      where: { id },
      relations: ['cliente', 'items'],
    });
    if (!f) throw new NotFoundException('Factura no encontrada');
    return f;
  }

  async generarYEnviarSIFEN(id: string): Promise<Factura> {
    const factura = await this.obtenerFactura(id);
    if (factura.estado !== 'BORRADOR') {
      throw new BadRequestException(`Solo se pueden enviar facturas en estado BORRADOR. Estado actual: ${factura.estado}`);
    }

    const codigoSeg = this.xmlGenerator.generarCodigoSeguridad();
    const cdc = this.xmlGenerator.generarCDC(factura, codigoSeg);
    factura.cdc = cdc;

    const emisor = this.getEmisorConfig();
    const xml = this.xmlGenerator.generarXML(factura, emisor);
    factura.xmlGenerado = xml;
    factura.estado = 'PENDIENTE';
    await this.facturaRepo.save(factura);

    const respuesta = await this.sifenService.enviarDE(xml, cdc);

    if (respuesta.estado === 'APROBADO') {
      factura.estado = 'APROBADO';
      if (respuesta.protocolo) factura.protocoloSifen = respuesta.protocolo;
      if (respuesta.codigoQR) factura.codigoQR = respuesta.codigoQR;
      factura.fechaAprobacion = new Date();
    } else if (respuesta.estado === 'RECHAZADO') {
      factura.estado = 'RECHAZADO';
    }
    factura.mensajeSifen = respuesta.mensaje;
    return this.facturaRepo.save(factura);
  }

  async cancelarFactura(id: string): Promise<Factura> {
    const factura = await this.obtenerFactura(id);
    if (factura.estado === 'CANCELADO') throw new BadRequestException('La factura ya está cancelada');
    factura.estado = 'CANCELADO';
    return this.facturaRepo.save(factura);
  }

  async obtenerXML(id: string): Promise<string> {
    const f = await this.obtenerFactura(id);
    if (!f.xmlGenerado) throw new BadRequestException('Esta factura no tiene XML generado aún');
    return f.xmlGenerado;
  }

  async consultarEstadoSifen(id: string): Promise<Factura> {
    const factura = await this.obtenerFactura(id);
    if (!factura.cdc) throw new BadRequestException('Esta factura no tiene CDC — envíela primero al SIFEN');
    const respuesta = await this.sifenService.consultarEstado(factura.cdc);
    if (respuesta.estado === 'APROBADO') {
      factura.estado = 'APROBADO';
      factura.protocoloSifen = respuesta.protocolo ?? factura.protocoloSifen;
      factura.codigoQR = respuesta.codigoQR ?? factura.codigoQR;
      factura.fechaAprobacion = factura.fechaAprobacion ?? new Date();
    }
    factura.mensajeSifen = respuesta.mensaje;
    return this.facturaRepo.save(factura);
  }

  // ─── Internos ─────────────────────────────────────────────────────────────────

  private calcularItem(item: ItemFactura): ItemFactura {
    const bruto = Number(item.cantidad) * Number(item.precioUnitario);
    const descMonto = bruto * (Number(item.descuentoPorcentaje) / 100);
    const neto = bruto - descMonto;

    item.descuentoMonto = descMonto;
    item.totalBruto = bruto;
    item.totalNeto = neto;

    const tasas: Record<string, number> = { IVA10: 10, IVA5: 5, EXENTA: 0, EXONERADA: 0 };
    const tasa = tasas[item.afectacionIVA];
    item.tasaIVA = tasa;

    if (tasa > 0) {
      item.baseGravada = neto / (1 + tasa / 100);
      item.ivaLiquidado = neto - item.baseGravada;
    } else {
      item.baseGravada = neto;
      item.ivaLiquidado = 0;
    }
    return item;
  }

  private calcularTotales(factura: Factura, items: ItemFactura[]): void {
    factura.subtotalExenta = items
      .filter((i) => i.afectacionIVA === 'EXENTA' || i.afectacionIVA === 'EXONERADA')
      .reduce((s, i) => s + Number(i.totalNeto), 0);
    factura.subtotal5 = items.filter((i) => i.afectacionIVA === 'IVA5').reduce((s, i) => s + Number(i.totalNeto), 0);
    factura.subtotal10 = items.filter((i) => i.afectacionIVA === 'IVA10').reduce((s, i) => s + Number(i.totalNeto), 0);
    factura.iva5 = items.filter((i) => i.afectacionIVA === 'IVA5').reduce((s, i) => s + Number(i.ivaLiquidado), 0);
    factura.iva10 = items.filter((i) => i.afectacionIVA === 'IVA10').reduce((s, i) => s + Number(i.ivaLiquidado), 0);
    factura.totalGeneral = items.reduce((s, i) => s + Number(i.totalNeto), 0);
  }

  private getEmisorConfig(): EmisorConfig {
    return {
      ruc: this.config.get<string>('EMISOR_RUC', '80000000'),
      dv: this.config.get<string>('EMISOR_DV', '0'),
      razonSocial: this.config.get<string>('EMISOR_RAZON_SOCIAL', 'RL SERVICIO LOGISTICO SRL'),
      nombreFantasia: this.config.get<string>('EMISOR_NOMBRE_FANTASIA', 'RL Logística'),
      direccion: this.config.get<string>('EMISOR_DIRECCION', 'Asunción, Paraguay'),
      numeroCasa: this.config.get<string>('EMISOR_NUMERO_CASA', '0'),
      codigoDepartamento: this.config.get<string>('EMISOR_COD_DPTO', '11'),
      codigoDistrito: this.config.get<string>('EMISOR_COD_DIST', '1'),
      codigoCiudad: this.config.get<string>('EMISOR_COD_CIUDAD', '1'),
      telefono: this.config.get<string>('EMISOR_TELEFONO', ''),
      email: this.config.get<string>('EMISOR_EMAIL', ''),
      actividadEconomica: this.config.get<string>('EMISOR_ACTIVIDAD', '52100'),
      descripcionActividad: this.config.get<string>('EMISOR_DESC_ACTIVIDAD', 'Almacenamiento y depósito'),
      responsable: this.config.get<string>('EMISOR_RESPONSABLE', 'Gerente General'),
      cargoResponsable: this.config.get<string>('EMISOR_CARGO', 'Gerente General'),
    };
  }
}
