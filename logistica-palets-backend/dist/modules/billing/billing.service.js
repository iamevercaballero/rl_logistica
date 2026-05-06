"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("typeorm");
const typeorm_2 = require("@nestjs/typeorm");
const cliente_entity_1 = require("./entities/cliente.entity");
const factura_entity_1 = require("./entities/factura.entity");
const item_factura_entity_1 = require("./entities/item-factura.entity");
const xml_generator_service_1 = require("./xml-generator.service");
const sifen_service_1 = require("./sifen.service");
let BillingService = class BillingService {
    constructor(dataSource, clienteRepo, facturaRepo, xmlGenerator, sifenService, config) {
        this.dataSource = dataSource;
        this.clienteRepo = clienteRepo;
        this.facturaRepo = facturaRepo;
        this.xmlGenerator = xmlGenerator;
        this.sifenService = sifenService;
        this.config = config;
    }
    async crearCliente(dto) {
        const existe = await this.clienteRepo.findOne({ where: { ruc: dto.ruc } });
        if (existe)
            throw new common_1.BadRequestException(`RUC ${dto.ruc} ya está registrado`);
        const cliente = this.clienteRepo.create(dto);
        return this.clienteRepo.save(cliente);
    }
    async listarClientes() {
        return this.clienteRepo.find({ where: { activo: true }, order: { razonSocial: 'ASC' } });
    }
    async obtenerCliente(id) {
        const c = await this.clienteRepo.findOne({ where: { id } });
        if (!c)
            throw new common_1.NotFoundException('Cliente no encontrado');
        return c;
    }
    async actualizarCliente(id, dto) {
        const c = await this.obtenerCliente(id);
        Object.assign(c, dto);
        return this.clienteRepo.save(c);
    }
    async desactivarCliente(id) {
        const c = await this.obtenerCliente(id);
        c.activo = false;
        await this.clienteRepo.save(c);
    }
    async crearFactura(dto, userId) {
        var _a;
        const cliente = await this.clienteRepo.findOne({ where: { id: dto.clienteId, activo: true } });
        if (!cliente)
            throw new common_1.NotFoundException('Cliente no encontrado o inactivo');
        if (!((_a = dto.items) === null || _a === void 0 ? void 0 : _a.length))
            throw new common_1.BadRequestException('La factura debe tener al menos un ítem');
        return this.dataSource.transaction(async (manager) => {
            var _a, _b;
            const timbrado = this.config.get('FACTURA_TIMBRADO', '12345678');
            const vigencia = this.config.get('FACTURA_VIGENCIA', new Date(Date.now() + 365 * 86400000).toISOString());
            const establecimiento = this.config.get('FACTURA_ESTABLECIMIENTO', '001');
            const puntoExpedicion = this.config.get('FACTURA_PUNTO_EXPEDICION', '001');
            const ultimo = await manager
                .createQueryBuilder(factura_entity_1.Factura, 'f')
                .where('f.establecimiento = :est AND f.puntoExpedicion = :pun', { est: establecimiento, pun: puntoExpedicion })
                .orderBy('f.numeroDocumento', 'DESC')
                .getOne();
            const numeroDocumento = ((_a = ultimo === null || ultimo === void 0 ? void 0 : ultimo.numeroDocumento) !== null && _a !== void 0 ? _a : 0) + 1;
            const factura = manager.create(factura_entity_1.Factura, {
                tipoDE: dto.tipoDE,
                clienteId: dto.clienteId,
                cliente,
                fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
                condicionPago: dto.condicionPago,
                moneda: (_b = dto.moneda) !== null && _b !== void 0 ? _b : 'PYG',
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
            const items = dto.items.map((i, idx) => {
                var _a, _b;
                return this.calcularItem(manager.create(item_factura_entity_1.ItemFactura, {
                    orden: idx + 1,
                    codigo: i.codigo,
                    descripcion: i.descripcion,
                    unidadMedida: (_a = i.unidadMedida) !== null && _a !== void 0 ? _a : 'UNI',
                    cantidad: Number(i.cantidad),
                    precioUnitario: Number(i.precioUnitario),
                    descuentoPorcentaje: Number((_b = i.descuentoPorcentaje) !== null && _b !== void 0 ? _b : 0),
                    afectacionIVA: i.afectacionIVA,
                }));
            });
            this.calcularTotales(factura, items);
            const saved = await manager.save(factura_entity_1.Factura, factura);
            items.forEach((it) => (it.facturaId = saved.id));
            await manager.save(item_factura_entity_1.ItemFactura, items);
            saved.items = items;
            return saved;
        });
    }
    async listarFacturas(query) {
        var _a, _b;
        const qb = this.facturaRepo.createQueryBuilder('f')
            .leftJoinAndSelect('f.cliente', 'c')
            .leftJoinAndSelect('f.items', 'i')
            .orderBy('f.createdAt', 'DESC');
        if (query.estado)
            qb.andWhere('f.estado = :estado', { estado: query.estado });
        if (query.clienteId)
            qb.andWhere('f.clienteId = :clienteId', { clienteId: query.clienteId });
        if (query.desde)
            qb.andWhere('f.fecha >= :desde', { desde: query.desde });
        if (query.hasta)
            qb.andWhere('f.fecha <= :hasta', { hasta: query.hasta });
        if (query.buscar) {
            qb.andWhere('(c.razonSocial ILIKE :q OR c.ruc ILIKE :q OR CAST(f.numeroDocumento AS TEXT) ILIKE :q)', { q: `%${query.buscar}%` });
        }
        const total = await qb.getCount();
        const page = (_a = query.page) !== null && _a !== void 0 ? _a : 1;
        const limit = (_b = query.limit) !== null && _b !== void 0 ? _b : 20;
        qb.skip((page - 1) * limit).take(limit);
        const data = await qb.getMany();
        return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }
    async obtenerFactura(id) {
        const f = await this.facturaRepo.findOne({
            where: { id },
            relations: ['cliente', 'items'],
        });
        if (!f)
            throw new common_1.NotFoundException('Factura no encontrada');
        return f;
    }
    async generarYEnviarSIFEN(id) {
        const factura = await this.obtenerFactura(id);
        if (factura.estado !== 'BORRADOR') {
            throw new common_1.BadRequestException(`Solo se pueden enviar facturas en estado BORRADOR. Estado actual: ${factura.estado}`);
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
            if (respuesta.protocolo)
                factura.protocoloSifen = respuesta.protocolo;
            if (respuesta.codigoQR)
                factura.codigoQR = respuesta.codigoQR;
            factura.fechaAprobacion = new Date();
        }
        else if (respuesta.estado === 'RECHAZADO') {
            factura.estado = 'RECHAZADO';
        }
        factura.mensajeSifen = respuesta.mensaje;
        return this.facturaRepo.save(factura);
    }
    async cancelarFactura(id) {
        const factura = await this.obtenerFactura(id);
        if (factura.estado === 'CANCELADO')
            throw new common_1.BadRequestException('La factura ya está cancelada');
        factura.estado = 'CANCELADO';
        return this.facturaRepo.save(factura);
    }
    async obtenerXML(id) {
        const f = await this.obtenerFactura(id);
        if (!f.xmlGenerado)
            throw new common_1.BadRequestException('Esta factura no tiene XML generado aún');
        return f.xmlGenerado;
    }
    async consultarEstadoSifen(id) {
        var _a, _b, _c;
        const factura = await this.obtenerFactura(id);
        if (!factura.cdc)
            throw new common_1.BadRequestException('Esta factura no tiene CDC — envíela primero al SIFEN');
        const respuesta = await this.sifenService.consultarEstado(factura.cdc);
        if (respuesta.estado === 'APROBADO') {
            factura.estado = 'APROBADO';
            factura.protocoloSifen = (_a = respuesta.protocolo) !== null && _a !== void 0 ? _a : factura.protocoloSifen;
            factura.codigoQR = (_b = respuesta.codigoQR) !== null && _b !== void 0 ? _b : factura.codigoQR;
            factura.fechaAprobacion = (_c = factura.fechaAprobacion) !== null && _c !== void 0 ? _c : new Date();
        }
        factura.mensajeSifen = respuesta.mensaje;
        return this.facturaRepo.save(factura);
    }
    calcularItem(item) {
        const bruto = Number(item.cantidad) * Number(item.precioUnitario);
        const descMonto = bruto * (Number(item.descuentoPorcentaje) / 100);
        const neto = bruto - descMonto;
        item.descuentoMonto = descMonto;
        item.totalBruto = bruto;
        item.totalNeto = neto;
        const tasas = { IVA10: 10, IVA5: 5, EXENTA: 0, EXONERADA: 0 };
        const tasa = tasas[item.afectacionIVA];
        item.tasaIVA = tasa;
        if (tasa > 0) {
            item.baseGravada = neto / (1 + tasa / 100);
            item.ivaLiquidado = neto - item.baseGravada;
        }
        else {
            item.baseGravada = neto;
            item.ivaLiquidado = 0;
        }
        return item;
    }
    calcularTotales(factura, items) {
        factura.subtotalExenta = items
            .filter((i) => i.afectacionIVA === 'EXENTA' || i.afectacionIVA === 'EXONERADA')
            .reduce((s, i) => s + Number(i.totalNeto), 0);
        factura.subtotal5 = items.filter((i) => i.afectacionIVA === 'IVA5').reduce((s, i) => s + Number(i.totalNeto), 0);
        factura.subtotal10 = items.filter((i) => i.afectacionIVA === 'IVA10').reduce((s, i) => s + Number(i.totalNeto), 0);
        factura.iva5 = items.filter((i) => i.afectacionIVA === 'IVA5').reduce((s, i) => s + Number(i.ivaLiquidado), 0);
        factura.iva10 = items.filter((i) => i.afectacionIVA === 'IVA10').reduce((s, i) => s + Number(i.ivaLiquidado), 0);
        factura.totalGeneral = items.reduce((s, i) => s + Number(i.totalNeto), 0);
    }
    getEmisorConfig() {
        return {
            ruc: this.config.get('EMISOR_RUC', '80000000'),
            dv: this.config.get('EMISOR_DV', '0'),
            razonSocial: this.config.get('EMISOR_RAZON_SOCIAL', 'RL SERVICIO LOGISTICO SRL'),
            nombreFantasia: this.config.get('EMISOR_NOMBRE_FANTASIA', 'RL Logística'),
            direccion: this.config.get('EMISOR_DIRECCION', 'Asunción, Paraguay'),
            numeroCasa: this.config.get('EMISOR_NUMERO_CASA', '0'),
            codigoDepartamento: this.config.get('EMISOR_COD_DPTO', '11'),
            codigoDistrito: this.config.get('EMISOR_COD_DIST', '1'),
            codigoCiudad: this.config.get('EMISOR_COD_CIUDAD', '1'),
            telefono: this.config.get('EMISOR_TELEFONO', ''),
            email: this.config.get('EMISOR_EMAIL', ''),
            actividadEconomica: this.config.get('EMISOR_ACTIVIDAD', '52100'),
            descripcionActividad: this.config.get('EMISOR_DESC_ACTIVIDAD', 'Almacenamiento y depósito'),
            responsable: this.config.get('EMISOR_RESPONSABLE', 'Gerente General'),
            cargoResponsable: this.config.get('EMISOR_CARGO', 'Gerente General'),
        };
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, typeorm_2.InjectRepository)(cliente_entity_1.Cliente)),
    __param(2, (0, typeorm_2.InjectRepository)(factura_entity_1.Factura)),
    __metadata("design:paramtypes", [typeorm_1.DataSource,
        typeorm_1.Repository,
        typeorm_1.Repository,
        xml_generator_service_1.XmlGeneratorService,
        sifen_service_1.SifenService,
        config_1.ConfigService])
], BillingService);
//# sourceMappingURL=billing.service.js.map