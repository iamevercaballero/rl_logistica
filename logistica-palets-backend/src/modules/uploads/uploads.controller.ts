import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuid } from 'uuid';
import { Response, Request } from 'express';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { AttachmentCategory, AttachmentEntityType } from './entities/attachment.entity';

function multerStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      const now = new Date();
      const subdir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const dir = UploadsService.ensureUploadDir(subdir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      cb(null, `${uuid()}${ext}`);
    },
  });
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attachments')
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  /**
   * Sube un archivo y lo vincula a una entidad (MOVEMENT, DOCUMENT, ADJUSTMENT).
   * El campo `name` es obligatorio — el operador debe nombrar cada archivo.
   */
  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @UseInterceptors(FileInterceptor('file', { storage: multerStorage() }))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Query('name') name: string,
    @Query('category') category: AttachmentCategory,
    @Query('entityType') entityType: AttachmentEntityType,
    @Query('entityId') entityId: string,
    @Req() req: Request & { user: { userId: string; username?: string } },
  ) {
    if (!file) throw new Error('No se recibió ningún archivo.');
    return this.service.saveAttachment(
      file,
      { name, category: category ?? 'OTRO', entityType, entityId },
      req.user.userId,
      req.user.username,
    );
  }

  /** Lista adjuntos de una entidad. */
  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  list(
    @Query('entityType') entityType: AttachmentEntityType,
    @Query('entityId') entityId: string,
  ) {
    return this.service.getAttachments(entityType, entityId);
  }

  /** Todos los eventos del sistema — Bitácora global. */
  @Get('events')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  getAllEvents(
    @Query() query: {
      entityType?: string; eventType?: string;
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
  getLog(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
  ) {
    return this.service.getDispatchLog(entityType, entityId);
  }

  /** Descarga / visualiza un archivo adjunto. */
  @Get(':id/file')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, mimeType, filename } = await this.service.streamFile(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}"`,
    });
    return stream;
  }

  /** Elimina un adjunto (solo MANAGER/ADMIN). */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(
    @Param('id') id: string,
    @Req() req: Request & { user: { userId: string; username?: string } },
  ) {
    return this.service.deleteAttachment(id, req.user.userId, req.user.username);
  }
}
