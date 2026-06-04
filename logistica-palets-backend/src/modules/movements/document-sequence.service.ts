import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DocumentSequence } from './entities/document-sequence.entity';
import { DocumentType } from './entities/logistics-document.entity';
import { AdjustmentRequestType } from '../adjustments/entities/adjustment-request.entity';

/** Todos los tipos de documento que generan código correlativo. */
export type SequenceableType = DocumentType | AdjustmentRequestType;

const PREFIX_BY_TYPE: Record<SequenceableType, string> = {
  ENTRY:          'RLNE',
  EXIT:           'RLNS',
  ADJUSTMENT_IN:  'RLAI',
  ADJUSTMENT_OUT: 'RLAO',
};

@Injectable()
export class DocumentSequenceService {
  /**
   * Devuelve el siguiente código correlativo para el tipo dado, ej: RLNE-2026-000001.
   * Debe ejecutarse dentro de una transacción: bloquea la fila (FOR UPDATE) para
   * evitar huecos y colisiones bajo concurrencia.
   */
  async nextCode(manager: EntityManager, type: SequenceableType, date = new Date()): Promise<string> {
    const prefix = PREFIX_BY_TYPE[type];
    const year = date.getFullYear();
    const repo = manager.getRepository(DocumentSequence);

    // Bloqueo pesimista de la fila de la secuencia (o creación si no existe).
    let seq = await repo
      .createQueryBuilder('s')
      .setLock('pessimistic_write')
      .where('s.prefix = :prefix AND s.year = :year', { prefix, year })
      .getOne();

    if (!seq) {
      seq = repo.create({ prefix, year, lastNumber: 0 });
    }

    seq.lastNumber += 1;
    await repo.save(seq);

    const padded = String(seq.lastNumber).padStart(6, '0');
    return `${prefix}-${year}-${padded}`;
  }
}
