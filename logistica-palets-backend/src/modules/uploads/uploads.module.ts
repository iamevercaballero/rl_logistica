import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { Attachment } from './entities/attachment.entity';
import { DocumentEvent } from './entities/document-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment, DocumentEvent])],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],   // Exportado para que otros servicios puedan loguear eventos
})
export class UploadsModule {}
