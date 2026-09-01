import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { v4 as uuid } from 'uuid';
import { Response, Request } from 'express';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { MulterExceptionFilter } from './multer-exception.filter';
import { AttachmentQueryDto, UploadAttachmentDto } from './dto/upload-attachment.dto';
import {
  attachmentExtension,
  isAllowedAttachment,
  isInlineSafe,
  MAX_ATTACHMENT_SIZE,
  UNSUPPORTED_ATTACHMENT_MESSAGE,
} from './attachment-types';

function multerStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const now = new Date();
      const subdir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = UploadsService.ensureUploadDir(subdir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      // El nombre en disco es siempre un uuid: el `originalname` viene del cliente
      // y no debe influir en la ruta. La extensión ya pasó por la lista blanca.
      cb(null, `${uuid()}${attachmentExtension(file.originalname)}`);
    },
  });
}

/**
 * Opciones de multer para los adjuntos.
 *
 * `limits` es lo que realmente corta: antes el control de tamaño estaba en
 * `saveAttachment`, o sea **después** de que multer escribiera el archivo entero
 * en disco, y el archivo rechazado además quedaba ahí. Subir 500 MB repetidas
 * veces llenaba el volumen sin que ninguna validación lo impidiera.
 *
 * `fileFilter` rechaza por extensión antes de escribir un solo byte. Es el mismo
 * criterio que ya usaba `products/bulk-import`; los adjuntos habían quedado fuera.
 */
const ATTACHMENT_UPLOAD: MulterOptions = {
  storage: multerStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedAttachment(file.originalname)) {
      cb(new BadRequestException(UNSUPPORTED_ATTACHMENT_MESSAGE), false);
      return;
    }
    cb(null, true);
  },
};

@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Controller('attachments')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  /**
   * Sube un archivo y lo vincula a una entidad (MOVEMENT, DOCUMENT, ADJUSTMENT).
   * El campo `name` es obligatorio — el operador debe nombrar cada archivo.
   */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(FileInterceptor('file', ATTACHMENT_UPLOAD))
  @RequirePermission('attachments', 'create')
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query() dto: UploadAttachmentDto,
    @Req() req: Request & { user: { userId: string; username?: string } },
  ) {
    // 400, no un Error pelado: sin `file` la petición está mal formada, no es
    // una falla del servidor.
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    return this.service.saveAttachment(
      file,
      { ...dto, category: dto.category ?? 'OTRO' },
      req.user.userId,
      req.user.username,
    );
  }

  /** Lista adjuntos de una entidad. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('attachments', 'read')
  list(@Query() query: AttachmentQueryDto) {
    return this.service.getAttachments(query.entityType, query.entityId);
  }

  /** Todos los eventos del sistema — Bitácora global. */
  @Get('events')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  getAllEvents(
    @Query() query: {
      entityType?: string; eventType?: string; excludeEventTypes?: string;
      from?: string; to?: string;
      search?: string; page?: string; limit?: string;
    },
  ) {
    return this.service.getAllEvents({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  /** Historial completo (eventos + adjuntos) de una entidad. */
  @Get('log')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('bitacora', 'read')
  getLog(@Query() query: AttachmentQueryDto) {
    return this.service.getDispatchLog(query.entityType, query.entityId);
  }

  /**
   * Descarga / visualiza un archivo adjunto.
   *
   * El `Content-Type` sale de la extensión validada al subir, no de lo que
   * declaró el cliente. Y sólo las imágenes se sirven `inline`: el resto va como
   * descarga, para que ningún adjunto se renderice como documento en el
   * navegador. El frontend no depende de esto —abre todo desde un Blob— pero
   * quien pegue la URL directa queda igual de cubierto.
   */
  @Get(':id/file')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  @RequirePermission('attachments', 'read')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, mimeType, filename } = await this.service.streamFile(id);
    const disposition = isInlineSafe(mimeType) ? 'inline' : 'attachment';
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // helmet ya lo pone global; explícito acá porque es lo que impide que el
      // navegador ignore el Content-Type y adivine el tipo por el contenido.
      'X-Content-Type-Options': 'nosniff',
    });
    return stream;
  }

  /** Elimina un adjunto (solo MANAGER/ADMIN). */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  @RequirePermission('attachments', 'remove')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: { userId: string; username?: string } },
  ) {
    return this.service.deleteAttachment(id, req.user.userId, req.user.username);
  }
}
