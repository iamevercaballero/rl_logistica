import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
  BadRequestException,
} from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';
import { MAX_ATTACHMENT_SIZE } from './attachment-types';

/**
 * Traduce los errores de multer a respuestas que el operador entienda.
 *
 * Sin esto, pasarse del tamaño máximo devolvía un 500 genérico: multer lanza un
 * `MulterError`, que no es una `HttpException`, y el filtro por defecto de Nest
 * lo convierte en «Internal server error». El operador no tenía forma de saber
 * que el problema era el peso del archivo.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mb = Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024));

    const traducido =
      error.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException(`El archivo supera el límite de ${mb} MB.`)
        : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
          ? new BadRequestException('Se admite un solo archivo por subida.')
          : new BadRequestException('No se pudo procesar el archivo enviado.');

    const status = traducido.getStatus() ?? HttpStatus.BAD_REQUEST;
    response.status(status).json(traducido.getResponse());
  }
}
