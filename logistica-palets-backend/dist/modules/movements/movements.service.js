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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MovementsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const movement_entity_1 = require("./entities/movement.entity");
const movement_detail_entity_1 = require("./entities/movement-detail.entity");
const pallet_entity_1 = require("../pallets/entities/pallet.entity");
let MovementsService = class MovementsService {
    constructor(dataSource) {
        this.dataSource = dataSource;
    }
    async createEntry(dto) {
        return this.dataSource.transaction(async (manager) => {
            const movement = manager.create(movement_entity_1.Movement, {
                type: 'ENTRADA',
                reference: dto.reference,
                notes: dto.notes,
            });
            await manager.save(movement);
            for (const item of dto.items) {
                const pallet = manager.create(pallet_entity_1.Pallet, {
                    code: item.palletCode,
                    lotId: item.lotId,
                    quantity: item.quantity,
                    currentLocationId: item.locationId,
                    status: 'AVAILABLE',
                });
                await manager.save(pallet);
                const detail = manager.create(movement_detail_entity_1.MovementDetail, {
                    movementId: movement.id,
                    palletId: pallet.id,
                    lotId: item.lotId,
                    locationId: item.locationId,
                    quantity: item.quantity,
                });
                await manager.save(detail);
            }
            return { movementId: movement.id };
        });
    }
    async createExit(dto) {
        return this.dataSource.transaction(async (manager) => {
            const movement = manager.create(movement_entity_1.Movement, {
                type: 'SALIDA',
                reference: dto.reference,
                notes: dto.notes,
            });
            await manager.save(movement);
            for (const item of dto.items) {
                const pallet = await manager.findOne(pallet_entity_1.Pallet, { where: { id: item.palletId } });
                if (!pallet)
                    throw new common_1.NotFoundException(`Pallet no encontrado: ${item.palletId}`);
                if (pallet.quantity < item.quantity) {
                    throw new common_1.BadRequestException(`Cantidad insuficiente en pallet ${pallet.code}`);
                }
                const detail = manager.create(movement_detail_entity_1.MovementDetail, {
                    movementId: movement.id,
                    palletId: pallet.id,
                    lotId: pallet.lotId,
                    locationId: pallet.currentLocationId,
                    quantity: item.quantity,
                });
                await manager.save(detail);
                if (pallet.quantity === item.quantity) {
                    await manager.remove(pallet);
                }
                else {
                    pallet.quantity -= item.quantity;
                    await manager.save(pallet);
                }
            }
            return { movementId: movement.id };
        });
    }
    async createTransfer(dto) {
        return this.dataSource.transaction(async (manager) => {
            const pallet = await manager.findOne(pallet_entity_1.Pallet, { where: { id: dto.palletId } });
            if (!pallet)
                throw new common_1.NotFoundException('Pallet no encontrado');
            if (pallet.quantity < dto.quantity) {
                throw new common_1.BadRequestException('Cantidad insuficiente para transferencia');
            }
            const movement = manager.create(movement_entity_1.Movement, {
                type: 'TRANSFERENCIA',
                reference: dto.reference,
                notes: dto.notes,
            });
            await manager.save(movement);
            await manager.save(manager.create(movement_detail_entity_1.MovementDetail, {
                movementId: movement.id,
                palletId: pallet.id,
                lotId: pallet.lotId,
                locationId: pallet.currentLocationId,
                quantity: dto.quantity,
            }));
            if (pallet.quantity === dto.quantity) {
                pallet.currentLocationId = dto.destinationLocationId;
                await manager.save(pallet);
                await manager.save(manager.create(movement_detail_entity_1.MovementDetail, {
                    movementId: movement.id,
                    palletId: pallet.id,
                    lotId: pallet.lotId,
                    locationId: dto.destinationLocationId,
                    quantity: dto.quantity,
                }));
                return { movementId: movement.id };
            }
            pallet.quantity -= dto.quantity;
            await manager.save(pallet);
            const newPallet = manager.create(pallet_entity_1.Pallet, {
                code: `${pallet.code}-T`,
                lotId: pallet.lotId,
                quantity: dto.quantity,
                currentLocationId: dto.destinationLocationId,
                status: pallet.status,
            });
            await manager.save(newPallet);
            await manager.save(manager.create(movement_detail_entity_1.MovementDetail, {
                movementId: movement.id,
                palletId: newPallet.id,
                lotId: pallet.lotId,
                locationId: dto.destinationLocationId,
                quantity: dto.quantity,
            }));
            return { movementId: movement.id, newPalletId: newPallet.id };
        });
    }
    async findAll() {
        return this.dataSource.getRepository(movement_entity_1.Movement).find({
            order: { date: 'DESC' },
        });
    }
    async findOne(id) {
        const movement = await this.dataSource.getRepository(movement_entity_1.Movement).findOne({
            where: { id },
        });
        if (!movement)
            throw new common_1.NotFoundException('Movimiento no encontrado');
        const details = await this.dataSource.getRepository(movement_detail_entity_1.MovementDetail).find({
            where: { movementId: id },
        });
        return { ...movement, details };
    }
};
exports.MovementsService = MovementsService;
exports.MovementsService = MovementsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeorm_1.DataSource])
], MovementsService);
//# sourceMappingURL=movements.service.js.map