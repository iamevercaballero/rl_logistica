import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';
import { Attachment, AttachmentCategory, AttachmentEntityType } from './entities/attachment.entity';
import { DocumentEvent, DocumentEventType } from './entities/document-event.entity';
import {
  attachmentMimeType,
  MAX_ATTACHMENT_SIZE,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
} from './attachment-types';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');

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

  /**
   * Resuelve `filePath` bajo `uploads/` y confirma que no se escapó del directorio.
   *
   * Hoy `filePath` siempre lo genera multer (`uuid` + extensión de la lista blanca),
   * así que no hay forma de que apunte afuera. La comprobación existe para que siga
   * siendo verdad si mañana alguien inserta un adjunto por otra vía: es la
   * diferencia entre un invariante y una casualidad.
   */
  private rutaDentroDeUploads(filePath: string): string {
    const full = resolve(UPLOADS_ROOT, filePath);
    const raiz = resolve(UPLOADS_ROOT);
    if (full !== raiz && !full.startsWith(raiz + sep)) {
      throw new NotFoundException('Archivo no encontrado.');
    }
    return full;
  }

  /** Borra el archivo recién escrito cuando la validación posterior lo rechaza. */
  private descartarArchivo(path?: string): void {
    if (!path) return;
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      /* si ya no está, mejor */
    }
  }

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
    // El MIME sale de la extensión, no de `file.mimetype`: ese lo declara quien
    // sube el archivo y se devolvía tal cual en el `Content-Type` de la descarga.
    // multer ya filtró por extensión; esto es el segundo candado, para que ningún
    // otro camino de llamada pueda guardar un tipo arbitrario.
    const mimeType = attachmentMimeType(file.originalname);
    if (!mimeType) {
      this.descartarArchivo(file.path);
      throw new BadRequestException(UNSUPPORTED_ATTACHMENT_MESSAGE);
    }

    // Backstop del límite de multer: si alguna vía dejara pasar un archivo más
    // grande, no queda registrado ni ocupando disco.
    if (file.size > MAX_ATTACHMENT_SIZE) {
      this.descartarArchivo(file.path);
      throw new BadRequestException(
        `El archivo supera el límite de ${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))} MB.`,
      );
    }

    if (!dto.name?.trim()) {
      this.descartarArchivo(file.path);
      throw new BadRequestException('El nombre del archivo es obligatorio.');
    }

    const attachment = this.attachRepo.create({
      name: dto.name.trim(),
      originalName: file.originalname,
      category: dto.category,
      mimeType,
      fileSize: file.size,
      filePath: file.path.replace(UPLOADS_ROOT + '/', '').replace(UPLOADS_ROOT + '\\', ''),
      entityType: dto.entityType,
      entityId: dto.entityId,
      createdById: userId,
    });
    await this.attachRepo.save(attachment);

    // Evento en bitácora
    await this.log({
      entityType: dto.entityType,
      entityId: dto.entityId,
      eventType: 'FOTO_ADJUNTADA',
      description: `Archivo adjuntado: "${dto.name.trim()}" (${dto.category}) — ${file.originalname}`,
      userId,
      username,
    });

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

    const fullPath = this.rutaDentroDeUploads(attachment.filePath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException('El archivo no existe en el servidor.');
    }

    // El MIME se vuelve a derivar de la extensión en cada lectura, en vez de
    // confiar en la columna. Los adjuntos subidos antes de este cambio guardaron
    // el `Content-Type` que declaró el cliente, así que uno viejo con `text/html`
    // seguiría sirviéndose como documento. Derivarlo acá cubre esas filas sin
    // necesitar una migración de datos.
    const mimeType = attachmentMimeType(attachment.originalName);

    return {
      stream: new StreamableFile(createReadStream(fullPath)),
      // Extensión no reconocida (sólo posible en filas anteriores a la lista
      // blanca): tipo genérico, que el navegador no renderiza.
      mimeType: mimeType ?? 'application/octet-stream',
      filename: attachment.originalName,
    };
  }

  async deleteAttachment(id: string, userId: string, username?: string) {
    const attachment = await this.attachRepo.findOne({ where: { id } });
    if (!attachment) throw new NotFoundException('Archivo no encontrado.');

    // Solo el creador o un MANAGER/ADMIN puede borrar
    // (la validación de rol la hace el controlador)

    // Misma resolución que la descarga: borrar es aún más delicado que leer.
    const fullPath = this.rutaDentroDeUploads(attachment.filePath);
    this.descartarArchivo(fullPath);

    await this.log({
      entityType: attachment.entityType as AttachmentEntityType,
      entityId: attachment.entityId,
      eventType: 'ARCHIVO_ELIMINADO',
      description: `Archivo eliminado: "${attachment.name}" — ${attachment.originalName}`,
      userId,
      username,
    });

    await this.attachRepo.delete(id);
    return { deleted: true };
  }

  // ─────────────────────────────────────────────────────────
  //  BITÁCORA (evento log)
  // ─────────────────────────────────────────────────────────

  /**
   * Registra un evento en la bitácora.
   * Público para que otros servicios lo puedan llamar.
   *
   * `manager` permite escribir el evento DENTRO de la transacción de la
   * operación que lo origina. Es la diferencia entre una bitácora que refleja
   * lo que pasó y una que refleja lo que pasó *casi siempre*: si el evento se
   * escribe aparte y falla, o el proceso muere entre el commit y el log, queda
   * un movimiento sin rastro de quién lo hizo. Pasándolo, o se guardan los dos
   * o no se guarda ninguno.
   */
  async log(evento: {
    entityType: string;
    entityId: string;
    eventType: DocumentEventType;
    description: string;
    userId?: string;
    username?: string;
    metadata?: Record<string, unknown>;
    entityCode?: string;
    /** Escribe el evento dentro de esta transacción — ver el comentario de arriba. */
    manager?: EntityManager;
  }) {
    const repo = evento.manager
      ? evento.manager.getRepository(DocumentEvent)
      : this.eventRepo;
    const event = repo.create({
      entityType: evento.entityType,
      entityId: evento.entityId,
      eventType: evento.eventType,
      description: evento.description,
      entityCode: evento.entityCode ?? null,
      userId: evento.userId ?? null,
      username: evento.username ?? null,
      metadata: evento.metadata ? JSON.stringify(evento.metadata) : null,
    });
    await repo.save(event);
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
