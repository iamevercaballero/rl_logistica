import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DocumentSequence, GLOBAL_SEQUENCE_SCOPE } from './entities/document-sequence.entity';
import { DocumentType } from './entities/logistics-document.entity';
import { AdjustmentRequestType } from '../adjustments/entities/adjustment-request.entity';
import { toBusinessDateString } from '../../common/date';

/** Todos los tipos de documento que generan código correlativo. */
export type SequenceableType = DocumentType | AdjustmentRequestType;
export type WarehouseSequenceScope = { warehouseId: string; documentCode: string };

const PREFIX_BY_TYPE: Record<SequenceableType, string> = {
  ENTRY:          'RLNE',
  EXIT:           'RLNS',
  ADJUSTMENT_IN:  'RLAI',
  ADJUSTMENT_OUT: 'RLAO',
};

@Injectable()
export class DocumentSequenceService {
  /**
   * Para documentos logísticos devuelve RLNE-01-000001 / RLNS-01-000001 y
   * particiona el correlativo por tipo + depósito. Los ajustes mantienen su
   * formato anual global. Debe ejecutarse dentro de una transacción.
   */
  async nextCode(
    manager: EntityManager,
    type: SequenceableType,
    date = new Date(),
    warehouse?: WarehouseSequenceScope,
  ): Promise<string> {
    const prefix = PREFIX_BY_TYPE[type];
    const isLogisticsDocument = type === 'ENTRY' || type === 'EXIT';
    if (isLogisticsDocument && !warehouse) {
      throw new BadRequestException('RLNE/RLNS requiere un depósito con código documental');
    }
    if (warehouse && !/^\d{2}$/.test(warehouse.documentCode)) {
      throw new BadRequestException('El depósito debe tener un código documental de 2 dígitos');
    }

    // getFullYear() lee el año en la zona del proceso (UTC en producción):
    // en la ventana entre que UTC ya cruzó a un año nuevo pero Asunción no,
    // el código correlativo arrancaba con el año equivocado.
    const year = isLogisticsDocument ? 0 : Number(toBusinessDateString(date)!.slice(0, 4));
    const warehouseId = warehouse?.warehouseId ?? GLOBAL_SEQUENCE_SCOPE;
    const repo = manager.getRepository(DocumentSequence);

    // El advisory lock cubre también la primera emisión, cuando todavía no hay
    // fila que SELECT ... FOR UPDATE pueda bloquear. Es transaccional y se
    // libera automáticamente al commit/rollback.
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`document-sequence:${prefix}:${year}:${warehouseId}`],
    );

    // Bloqueo pesimista de la fila de la secuencia ya existente.
    let seq = await repo
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.prefix = :prefix AND s.year = :year AND s.warehouseId = :warehouseId', {
        prefix,
        year,
        warehouseId,
      })
      .getOne();

    if (!seq) {
      seq = repo.create({ prefix, year, warehouseId, lastNumber: 0 });
    }

    seq.lastNumber += 1;
    await repo.save(seq);

    const padded = String(seq.lastNumber).padStart(6, '0');
    return isLogisticsDocument
      ? `${prefix}-${warehouse!.documentCode}-${padded}`
      : `${prefix}-${year}-${padded}`;
  }
}
