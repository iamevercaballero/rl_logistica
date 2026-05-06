import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { BillingService } from './billing.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { CreateFacturaDto } from './dto/create-factura.dto';
import { QueryFacturaDto } from './dto/query-factura.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles/roles.guard';
import { Roles } from '../auth/roles/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  // ─── Clientes ───────────────────────────────────────────────────────────────

  @Get('clientes')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  listarClientes() {
    return this.service.listarClientes();
  }

  @Post('clientes')
  @Roles('ADMIN', 'MANAGER')
  crearCliente(@Body() dto: CreateClienteDto) {
    return this.service.crearCliente(dto);
  }

  @Get('clientes/:id')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  obtenerCliente(@Param('id') id: string) {
    return this.service.obtenerCliente(id);
  }

  @Patch('clientes/:id')
  @Roles('ADMIN', 'MANAGER')
  actualizarCliente(@Param('id') id: string, @Body() dto: Partial<CreateClienteDto>) {
    return this.service.actualizarCliente(id, dto);
  }

  @Delete('clientes/:id')
  @Roles('ADMIN')
  desactivarCliente(@Param('id') id: string) {
    return this.service.desactivarCliente(id);
  }

  // ─── Facturas ────────────────────────────────────────────────────────────────

  @Get('facturas')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  listarFacturas(@Query() query: QueryFacturaDto) {
    return this.service.listarFacturas(query);
  }

  @Post('facturas')
  @Roles('ADMIN', 'MANAGER')
  crearFactura(
    @Body() dto: CreateFacturaDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.service.crearFactura(dto, req.user.userId);
  }

  @Get('facturas/:id')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  obtenerFactura(@Param('id') id: string) {
    return this.service.obtenerFactura(id);
  }

  @Post('facturas/:id/enviar-sifen')
  @Roles('ADMIN', 'MANAGER')
  enviarSIFEN(@Param('id') id: string) {
    return this.service.generarYEnviarSIFEN(id);
  }

  @Post('facturas/:id/cancelar')
  @Roles('ADMIN', 'MANAGER')
  cancelar(@Param('id') id: string) {
    return this.service.cancelarFactura(id);
  }

  @Post('facturas/:id/consultar-sifen')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  consultarSifen(@Param('id') id: string) {
    return this.service.consultarEstadoSifen(id);
  }

  @Get('facturas/:id/xml')
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  async descargarXML(@Param('id') id: string, @Res() res: Response) {
    const xml = await this.service.obtenerXML(id);
    const factura = await this.service.obtenerFactura(id);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="DE-${factura.cdc ?? id}.xml"`);
    res.send(xml);
  }
}
