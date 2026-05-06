import { api } from './client';

export type TipoContribuyente = 'JURIDICA' | 'FISICA';
export type TipoDE = 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO' | 'AUTOFACTURA' | 'NOTA_REMISION';
export type CondicionPago = 'CONTADO' | 'CREDITO';
export type EstadoFactura = 'BORRADOR' | 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO';
export type AfectacionIVA = 'IVA10' | 'IVA5' | 'EXENTA' | 'EXONERADA';

export interface Cliente {
  id: string;
  ruc: string;
  dv: string;
  razonSocial: string;
  nombreFantasia?: string;
  tipoContribuyente: TipoContribuyente;
  direccion?: string;
  email?: string;
  telefono?: string;
  activo: boolean;
  createdAt: string;
}

export interface ItemFactura {
  id: string;
  orden: number;
  codigo?: string;
  descripcion: string;
  unidadMedida: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  totalBruto: number;
  totalNeto: number;
  afectacionIVA: AfectacionIVA;
  tasaIVA: number;
  baseGravada: number;
  ivaLiquidado: number;
}

export interface Factura {
  id: string;
  tipoDE: TipoDE;
  establecimiento: string;
  puntoExpedicion: string;
  numeroDocumento: number;
  timbrado: string;
  cdc?: string;
  clienteId: string;
  cliente: Cliente;
  fecha: string;
  condicionPago: CondicionPago;
  moneda: string;
  subtotalExenta: number;
  subtotal5: number;
  subtotal10: number;
  iva5: number;
  iva10: number;
  totalGeneral: number;
  estado: EstadoFactura;
  codigoQR?: string;
  protocoloSifen?: string;
  mensajeSifen?: string;
  fechaAprobacion?: string;
  movimientoId?: string;
  observaciones?: string;
  createdAt: string;
  items: ItemFactura[];
}

export interface PaginatedFacturas {
  data: Factura[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface CreateClientePayload {
  ruc: string;
  dv: string;
  razonSocial: string;
  nombreFantasia?: string;
  tipoContribuyente: TipoContribuyente;
  direccion?: string;
  email?: string;
  telefono?: string;
}

export interface CreateItemPayload {
  codigo?: string;
  descripcion: string;
  unidadMedida?: string;
  cantidad: number;
  precioUnitario: number;
  descuentoPorcentaje?: number;
  afectacionIVA: AfectacionIVA;
}

export interface CreateFacturaPayload {
  tipoDE: TipoDE;
  clienteId: string;
  fecha?: string;
  condicionPago: CondicionPago;
  moneda?: string;
  movimientoId?: string;
  observaciones?: string;
  items: CreateItemPayload[];
}

export interface FacturaQueryParams {
  estado?: EstadoFactura;
  clienteId?: string;
  desde?: string;
  hasta?: string;
  buscar?: string;
  page?: number;
  limit?: number;
}

// Clientes
export async function getClientes(): Promise<Cliente[]> {
  const r = await api.get<Cliente[]>('/billing/clientes');
  return r.data;
}
export async function createCliente(payload: CreateClientePayload): Promise<Cliente> {
  const r = await api.post<Cliente>('/billing/clientes', payload);
  return r.data;
}
export async function updateCliente(id: string, payload: Partial<CreateClientePayload>): Promise<Cliente> {
  const r = await api.patch<Cliente>(`/billing/clientes/${id}`, payload);
  return r.data;
}

// Facturas
export async function getFacturas(params: FacturaQueryParams = {}): Promise<PaginatedFacturas> {
  const r = await api.get<PaginatedFacturas>('/billing/facturas', { params });
  return r.data;
}
export async function createFactura(payload: CreateFacturaPayload): Promise<Factura> {
  const r = await api.post<Factura>('/billing/facturas', payload);
  return r.data;
}
export async function getFactura(id: string): Promise<Factura> {
  const r = await api.get<Factura>(`/billing/facturas/${id}`);
  return r.data;
}
export async function enviarSIFEN(id: string): Promise<Factura> {
  const r = await api.post<Factura>(`/billing/facturas/${id}/enviar-sifen`);
  return r.data;
}
export async function cancelarFactura(id: string): Promise<Factura> {
  const r = await api.post<Factura>(`/billing/facturas/${id}/cancelar`);
  return r.data;
}
export async function consultarSIFEN(id: string): Promise<Factura> {
  const r = await api.post<Factura>(`/billing/facturas/${id}/consultar-sifen`);
  return r.data;
}
export function getXMLUrl(id: string): string {
  return `/api/billing/facturas/${id}/xml`;
}
