import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

const IMPORT_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findAll(@Query('search') search?: string) {
    return this.productsService.findAll(search);
  }

  @Get('alerts/stock-minimo')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  belowMinimum() {
    return this.productsService.findBelowMinimum();
  }

  @Get(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  /** Carga masiva de materiales desde un archivo Excel (.xlsx/.xls) o CSV. */
  @Post('bulk-import')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (!IMPORT_EXTENSIONS.includes(ext)) {
          cb(new BadRequestException('Formato no soportado. Usá un archivo .xlsx, .xls o .csv.'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  bulkImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo.');
    return this.productsService.bulkImport(file.buffer);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER', 'OPERATOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  /** Baja de material: operación de catálogo maestro, no de piso. */
  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }
}
