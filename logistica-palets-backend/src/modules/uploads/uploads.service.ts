import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Attachment, AttachmentCategory, AttachmentEntityType } from './entities/attachment.entity';
import { DocumentEvent, DocumentEventType } from './entities/document-event.entity';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class UploadsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachRepo: Repository<Attachment>,
    @InjectRepository(DocumentEvent)
    private readonly eventRepo: Repository<DocumentEvent>,
  ) {}

  // ─────────────────────────────────────────────────────────
  //  ADJUNTOS
  // ─────────────────────────────────────────────────────────

  async saveAttachment(
    file: Express.Multer.File,
    dto: {
      name: string;
      category: AttachmentCategory;
      entityType: AttachmentEntityType;
      entityId: string;
    },
    userId: string,
    username?: string,
  ) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('El nombre del archivo es obligatorio.');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo supera el límite de 20 MB.');
    }

    const attachment = this.attachRepo.create({
      name: dto.name.trim(),
      originalName: file.originalname,
      category: dto.category,
      mimeType: file.mimetype,
      fileSize: file.size,
      filePath: file.path.replace(UPLOADS_ROOT + '/', '').replace(UPLOADS_ROOT + '\\', ''),
      entityType: dto.entityType,
      entityId: dto.entityId,
      createdById: userId,
    });
    await this.attachRepo.save(attachment);

    // Evento en bitácora
    await this.log(
      dto.entityType,
      dto.entityId,
      'FOTO_ADJUNTADA',
      `Archivo adjuntado: "${dto.name.trim()}" (${dto.category}) — ${file.originalname}`,
      userId,
      username,
    );

    return attachment;
  }

  async getAttachments(entityType: AttachmentEntityType, entityId: string) {
    return this.attachRepo.find({
      where: { entityType, entityId },
      order: { createdAt: 'ASC' },
    });
  }

  async streamFile(id: string): Promise<{ stream: StreamableFile; mimeType: string; filename: string }> {
    const attachment = await this.attachRepo.findOne({ where: { id } });
    if (!attachment) throw new NotFoundException('Archivo no encontrado.');

    const fullPath = join(UPLOADS_ROOT, attachment.filePath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException('El archivo no existe en el servidor.');
    }

    return {
      stream: new StreamableFile(createReadStream(fullPath)),
      mimeType: attachment.mimeType,
      filename: attachment.originalName,
    };
  }

  async deleteAttachment(id: string, userId: string, username?: string) {
    const attachment = await this.attachRepo.findOne({ where: { id } });
    if (!attachment) throw new NotFoundException('Archivo no encontrado.');

    // Solo el creador o un MANAGER/ADMIN puede borrar
    // (la validación de rol la hace el controlador)

    const fullPath = join(UPLOADS_ROOT, attachment.filePath);
    if (existsSync(fullPath)) {
      try { unlinkSync(fullPath); } catch { /* ignorar si ya no existe */ }
    }

    await this.log(
      attachment.entityType as AttachmentEntityType,
      attachment.entityId,
      'ARCHIVO_ELIMINADO',
      `Archivo eliminado: "${attachment.name}" — ${attachment.originalName}`,
      userId,
      username,
    );

    await this.attachRepo.delete(id);
    return { deleted: true };
  }

  // ─────────────────────────────────────────────────────────
  //  BITÁCORA (evento log)
  // ─────────────────────────────────────────────────────────

  /**
   * Registra un evento en la bitácora.
   * Público para que otros servicios lo puedan llamar.
   */
  async log(
    entityType: string,
    entityId: string,
    eventType: DocumentEventType,
    description: string,
    userId?: string,
    username?: string,
    metadata?: Record<string, unknown>,
    entityCode?: string,
  ) {
    const event = this.eventRepo.create({
      entityType,
      entityId,
      eventType,
      description,
      entityCode: entityCode ?? null,
      userId: userId ?? null,
      username: username ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
    await this.eventRepo.save(event);
    return event;
  }

  /** Todos los eventos del sistema, paginados — para la Bitácora global. */
  async getAllEvents(query: {
    entityType?: string;
    eventType?: string;
    excludeEventTypes?: string; // CSV, e.g. "FOTO_ADJUNTADA,ARCHIVO_ELIMINADO"
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);

    const qb = this.eventRepo
      .createQueryBuilder('e')
      .orderBy('e.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.entityType) qb.andWhere('e.entityType = :et', { et: query.entityType });
    if (query.eventType)  qb.andWhere('e.eventType = :ev', { ev: query.eventType });
    if (query.excludeEventTypes) {
      const excluded = query.excludeEventTypes.split(',').map((s) => s.trim()).filter(Boolean);
      if (excluded.length > 0) qb.andWhere('e.eventType NOT IN (:...excl)', { excl: excluded });
    }
    if (query.from) qb.andWhere('e.createdAt >= :from', { from: new Date(query.from) });
    if (query.to)   qb.andWhere('e.createdAt <= :to', { to: new Date(query.to + 'T23:59:59') });
    if (query.search) {
      qb.andWhere('(e.description ILIKE :s OR e.entityCode ILIKE :s OR e.username ILIKE :s)',
        { s: `%${query.search}%` });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getEvents(entityType: string, entityId: string) {
    return this.eventRepo.find({
      where: { entityType, entityId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Devuelve el historial completo: eventos + adjuntos de una entidad.
   */
  async getDispatchLog(entityType: string, entityId: string) {
    const [events, attachments] = await Promise.all([
      this.getEvents(entityType, entityId),
      this.getAttachments(entityType as AttachmentEntityType, entityId),
    ]);
    return { events, attachments };
  }

  // ─────────────────────────────────────────────────────────
  //  UTILIDAD: asegurar directorios de upload
  // ─────────────────────────────────────────────────────────

  static ensureUploadDir(subdir: string): string {
    const dir = join(UPLOADS_ROOT, subdir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }
}
