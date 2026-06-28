import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1782626569588 implements MigrationInterface {
    name = 'InitialSchema1782626569588'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() requiere la extensión uuid-ossp. Con synchronize
        // TypeORM la creaba automáticamente; con migrations hay que crearla
        // explícitamente o el primer CREATE TABLE falla en una DB fresca.
        // Idempotente: seguro también para fake-apply sobre DB existente.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "type" character varying NOT NULL DEFAULT 'RACK', "zone" character varying(30), "aisle" character varying(20), "rack" character varying(20), "level" integer, "position" integer, "capacityPallets" integer, "active" boolean NOT NULL DEFAULT true, "warehouseId" uuid, CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_location_zone" ON "locations" ("zone") `);
        await queryRunner.query(`CREATE TABLE "warehouses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "address" character varying, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_56ae21ee2432b2270b48867e4be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "document_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entityType" character varying(20) NOT NULL, "entityId" uuid NOT NULL, "eventType" character varying(40) NOT NULL, "description" text NOT NULL, "metadata" text, "entityCode" character varying(40), "userId" uuid, "username" character varying(100), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bf1a908ea94874e55855ccf9601" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_doc_event_created_at" ON "document_events" ("createdAt") `);
        await queryRunner.query(`CREATE INDEX "idx_doc_event_entity" ON "document_events" ("entityType", "entityId") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying NOT NULL, "passwordHash" character varying NOT NULL, "role" character varying NOT NULL DEFAULT 'OPERATOR', "active" boolean NOT NULL DEFAULT true, "fullName" character varying, CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "transports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plate" character varying NOT NULL, "type" character varying NOT NULL, "description" character varying, "status" character varying(20) NOT NULL DEFAULT 'DISPONIBLE', "capacityPallets" integer, "capacityKg" integer, "driversJson" text, "notes" text, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_f1c7f51afd891fa301da438910e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "stocks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "warehouseId" uuid, "locationId" uuid, "currentQuantity" integer NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b5b1ee4ac914767229337974575" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_stock_product" ON "stocks" ("productId") `);
        await queryRunner.query(`CREATE INDEX "idx_stock_product_warehouse_location" ON "stocks" ("productId", "warehouseId", "locationId") `);
        await queryRunner.query(`CREATE TABLE "attachments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(200) NOT NULL, "originalName" character varying(255) NOT NULL, "category" character varying(20) NOT NULL, "mimeType" character varying(100) NOT NULL, "fileSize" integer NOT NULL, "filePath" character varying(500) NOT NULL, "entityType" character varying(20) NOT NULL, "entityId" uuid NOT NULL, "createdById" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_attachment_entity" ON "attachments" ("entityType", "entityId") `);
        await queryRunner.query(`CREATE TABLE "pallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "lotId" uuid NOT NULL, "quantity" integer NOT NULL, "currentLocationId" uuid, "status" character varying NOT NULL DEFAULT 'AVAILABLE', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "exitedAt" TIMESTAMP, CONSTRAINT "UQ_5e54bf1ac7672a93e250e13e878" UNIQUE ("code"), CONSTRAINT "PK_48669cf7be61a8bfb12730b4062" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_pallet_status" ON "pallets" ("status") `);
        await queryRunner.query(`CREATE INDEX "idx_pallet_lot" ON "pallets" ("lotId") `);
        await queryRunner.query(`CREATE INDEX "idx_pallet_current_location" ON "pallets" ("currentLocationId") `);
        await queryRunner.query(`CREATE TABLE "sap_stock_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "date" date NOT NULL, "productId" uuid NOT NULL, "warehouseId" uuid, "locationId" uuid, "sapQuantity" integer NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_af3c4fe7e792a43e8593ad9ea29" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_sap_snapshot_date_product" ON "sap_stock_snapshots" ("date", "productId") `);
        await queryRunner.query(`CREATE TABLE "movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "documentId" uuid, "type" character varying NOT NULL, "date" TIMESTAMP NOT NULL DEFAULT now(), "productId" uuid NOT NULL, "quantity" integer NOT NULL, "pallets" integer, "warehouseId" uuid, "locationId" uuid, "fromWarehouseId" uuid, "fromLocationId" uuid, "toWarehouseId" uuid, "toLocationId" uuid, "documentNumber" character varying, "supplier" character varying, "carrier" character varying, "driver" character varying, "destination" character varying, "notes" text, "palletId" uuid, "lotId" uuid, "createdById" uuid NOT NULL, "encargadoRecepcionId" uuid, "status" character varying NOT NULL DEFAULT 'NORMAL', "adjustmentReason" character varying, "adjustmentCategory" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "voidStatus" character varying NOT NULL DEFAULT 'NONE', "voidAdjRequestId" uuid, CONSTRAINT "PK_5a8e3da15ab8f2ce353e7f58f67" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_movement_document" ON "movements" ("documentId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_lot" ON "movements" ("lotId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_pallet" ON "movements" ("palletId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_type_status" ON "movements" ("type", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_product" ON "movements" ("productId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_created_at" ON "movements" ("createdAt") `);
        await queryRunner.query(`CREATE TABLE "movement_details" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "movementId" uuid NOT NULL, "palletId" uuid, "lotId" uuid, "locationId" uuid, "quantity" integer NOT NULL, "role" character varying, CONSTRAINT "PK_632eba915a1cfb8a19f16d1e9fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_movement_detail_location" ON "movement_details" ("locationId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_detail_lot" ON "movement_details" ("lotId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_detail_pallet" ON "movement_details" ("palletId") `);
        await queryRunner.query(`CREATE INDEX "idx_movement_detail_movement" ON "movement_details" ("movementId") `);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying NOT NULL, "description" character varying NOT NULL, "unitOfMeasure" character varying, "active" boolean NOT NULL DEFAULT true, "stockMinimo" integer, "stackable" boolean NOT NULL DEFAULT true, "maxStackLevel" integer, "canReceiveWeightOnTop" boolean NOT NULL DEFAULT true, "stackingNotes" character varying, CONSTRAINT "UQ_7cfc24d6c24f0ec91294003d6b8" UNIQUE ("code"), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "lots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lotCode" character varying NOT NULL, "productId" uuid NOT NULL, "fechaVencimiento" date, "fechaFabricacion" date, "proveedor" character varying, "sapLot" character varying, "stockActual" integer NOT NULL DEFAULT '0', "status" character varying NOT NULL DEFAULT 'NORMAL', CONSTRAINT "PK_2bb990a4015865cb1daa1d22fd9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_lot_vencimiento" ON "lots" ("fechaVencimiento") `);
        await queryRunner.query(`CREATE INDEX "idx_lot_product" ON "lots" ("productId") `);
        await queryRunner.query(`CREATE INDEX "idx_lot_status" ON "lots" ("status") `);
        await queryRunner.query(`CREATE TABLE "logistics_documents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(24) NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'APROBADO', "date" TIMESTAMP NOT NULL DEFAULT now(), "documentNumber" character varying(80), "supplier" character varying(120), "destination" character varying(120), "warehouseId" uuid, "carrier" character varying(120), "driver" character varying(120), "vehiclePlate" character varying(30), "encargadoId" uuid, "notes" text, "totalLines" integer NOT NULL DEFAULT '0', "totalQuantity" integer NOT NULL DEFAULT '0', "createdById" uuid NOT NULL, "approvedById" uuid, "approvedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1649af4ba059c3c4dc115bfdc0b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_document_code" ON "logistics_documents" ("code") `);
        await queryRunner.query(`CREATE INDEX "idx_document_type_status" ON "logistics_documents" ("type", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_document_created_at" ON "logistics_documents" ("createdAt") `);
        await queryRunner.query(`CREATE TYPE "public"."clientes_tipocontribuyente_enum" AS ENUM('JURIDICA', 'FISICA')`);
        await queryRunner.query(`CREATE TABLE "clientes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ruc" character varying(20) NOT NULL, "dv" character varying(2) NOT NULL, "razonSocial" character varying(200) NOT NULL, "nombreFantasia" character varying(200), "tipoContribuyente" "public"."clientes_tipocontribuyente_enum" NOT NULL DEFAULT 'JURIDICA', "direccion" character varying(300), "email" character varying(100), "telefono" character varying(30), "codigoDepartamento" character varying(5), "codigoDistrito" character varying(5), "codigoCiudad" character varying(5), "activo" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_d8747b033a4210f1d835e776c58" UNIQUE ("ruc"), CONSTRAINT "PK_d76bf3571d906e4e86470482c08" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."facturas_tipode_enum" AS ENUM('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'AUTOFACTURA', 'NOTA_REMISION')`);
        await queryRunner.query(`CREATE TYPE "public"."facturas_condicionpago_enum" AS ENUM('CONTADO', 'CREDITO')`);
        await queryRunner.query(`CREATE TYPE "public"."facturas_estado_enum" AS ENUM('BORRADOR', 'PENDIENTE', 'APROBADO', 'RECHAZADO', 'CANCELADO')`);
        await queryRunner.query(`CREATE TABLE "facturas" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tipoDE" "public"."facturas_tipode_enum" NOT NULL DEFAULT 'FACTURA', "establecimiento" character varying(3) NOT NULL, "puntoExpedicion" character varying(3) NOT NULL, "numeroDocumento" integer NOT NULL, "timbrado" character varying(20) NOT NULL, "fechaVigenciaTimbrado" date NOT NULL, "cdc" character varying(44), "clienteId" uuid NOT NULL, "fecha" TIMESTAMP NOT NULL DEFAULT now(), "condicionPago" "public"."facturas_condicionpago_enum" NOT NULL DEFAULT 'CONTADO', "moneda" character varying(3) NOT NULL DEFAULT 'PYG', "subtotalExenta" numeric(18,2) NOT NULL DEFAULT '0', "subtotal5" numeric(18,2) NOT NULL DEFAULT '0', "subtotal10" numeric(18,2) NOT NULL DEFAULT '0', "iva5" numeric(18,2) NOT NULL DEFAULT '0', "iva10" numeric(18,2) NOT NULL DEFAULT '0', "totalGeneral" numeric(18,2) NOT NULL DEFAULT '0', "estado" "public"."facturas_estado_enum" NOT NULL DEFAULT 'BORRADOR', "xmlGenerado" text, "codigoQR" character varying(500), "protocoloSifen" character varying(20), "mensajeSifen" character varying(1000), "fechaAprobacion" TIMESTAMP, "movimientoId" uuid, "createdById" uuid NOT NULL, "observaciones" character varying(500), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f302947c1e4773639b20707a8bc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b7e7a73f09b393bb666a13441e" ON "facturas" ("cdc") WHERE cdc IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "idx_facturas_estado" ON "facturas" ("estado") `);
        await queryRunner.query(`CREATE INDEX "idx_facturas_fecha" ON "facturas" ("fecha") `);
        await queryRunner.query(`CREATE INDEX "idx_facturas_cliente" ON "facturas" ("clienteId") `);
        await queryRunner.query(`CREATE TYPE "public"."items_factura_afectacioniva_enum" AS ENUM('IVA10', 'IVA5', 'EXENTA', 'EXONERADA')`);
        await queryRunner.query(`CREATE TABLE "items_factura" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "facturaId" uuid NOT NULL, "orden" integer NOT NULL, "codigo" character varying(50), "descripcion" character varying(500) NOT NULL, "unidadMedida" character varying(10) NOT NULL DEFAULT 'UNI', "cantidad" numeric(14,4) NOT NULL, "precioUnitario" numeric(18,2) NOT NULL, "descuentoPorcentaje" numeric(5,2) NOT NULL DEFAULT '0', "descuentoMonto" numeric(18,2) NOT NULL DEFAULT '0', "totalBruto" numeric(18,2) NOT NULL, "totalNeto" numeric(18,2) NOT NULL, "afectacionIVA" "public"."items_factura_afectacioniva_enum" NOT NULL DEFAULT 'IVA10', "tasaIVA" numeric(5,2) NOT NULL DEFAULT '10', "baseGravada" numeric(18,2) NOT NULL DEFAULT '0', "ivaLiquidado" numeric(18,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_fe7d797d9aea1d4598b88eda8e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_items_factura_factura" ON "items_factura" ("facturaId") `);
        await queryRunner.query(`CREATE TABLE "alert_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "description" character varying, "productId" uuid, "warehouseId" uuid, "thresholdMin" integer NOT NULL DEFAULT '0', "enabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ae580564f087ffab9d229225aec" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "adjustment_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(24) NOT NULL, "type" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'BORRADOR', "reason" character varying(60) NOT NULL, "adjustmentCategory" character varying(120), "warehouseId" uuid, "locationId" uuid, "notes" text, "rejectReason" text, "totalLines" integer NOT NULL DEFAULT '0', "totalQuantity" integer NOT NULL DEFAULT '0', "createdById" uuid NOT NULL, "approvedById" uuid, "approvedAt" TIMESTAMP, "originalMovementId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_53c13952ca8850e9886c38b1e56" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_adj_request_code" ON "adjustment_requests" ("code") `);
        await queryRunner.query(`CREATE INDEX "idx_adj_request_type_status" ON "adjustment_requests" ("type", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_adj_request_created_at" ON "adjustment_requests" ("createdAt") `);
        await queryRunner.query(`CREATE TABLE "adjustment_request_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "requestId" uuid NOT NULL, "productId" uuid NOT NULL, "palletItemsJson" text NOT NULL, "totalQuantity" integer NOT NULL DEFAULT '0', "locationId" uuid, CONSTRAINT "PK_3ca7693913bfa1dc285e7e2cb08" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_adj_line_request" ON "adjustment_request_lines" ("requestId") `);
        await queryRunner.query(`CREATE TABLE "document_sequences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "prefix" character varying(8) NOT NULL, "year" integer NOT NULL, "lastNumber" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_be5517d83b0425544ef91e6c897" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_document_sequence_key" ON "document_sequences" ("prefix", "year") `);
        await queryRunner.query(`CREATE TABLE "regularization_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "movementId" uuid NOT NULL, "field" character varying NOT NULL, "oldValue" text, "newValue" text, "changedById" uuid NOT NULL, "reason" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_132145a2748e1b3e6ecf1d7e937" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_regularization_movement" ON "regularization_logs" ("movementId") `);
        await queryRunner.query(`ALTER TABLE "locations" ADD CONSTRAINT "FK_3e4f83b9faa7491b9f86294f53e" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "lots" ADD CONSTRAINT "FK_35a1a6e15f94d9204be952ed03f" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "facturas" ADD CONSTRAINT "FK_be6dba2298d9414913463f492bb" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "items_factura" ADD CONSTRAINT "FK_1d6b418bb3cf6cfdac70f5b4584" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        // uq_stock_cell: índice único de expresión (no está declarado en ninguna
        // entidad, por eso el generador no lo incluye). Garantiza una sola fila
        // de stock por (producto, depósito, ubicación), tratando NULL como UUID cero.
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_stock_cell" ON stocks ("productId", COALESCE("warehouseId", '00000000-0000-0000-0000-000000000000'::uuid), COALESCE("locationId", '00000000-0000-0000-0000-000000000000'::uuid))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "uq_stock_cell"`);
        await queryRunner.query(`ALTER TABLE "items_factura" DROP CONSTRAINT "FK_1d6b418bb3cf6cfdac70f5b4584"`);
        await queryRunner.query(`ALTER TABLE "facturas" DROP CONSTRAINT "FK_be6dba2298d9414913463f492bb"`);
        await queryRunner.query(`ALTER TABLE "lots" DROP CONSTRAINT "FK_35a1a6e15f94d9204be952ed03f"`);
        await queryRunner.query(`ALTER TABLE "locations" DROP CONSTRAINT "FK_3e4f83b9faa7491b9f86294f53e"`);
        await queryRunner.query(`DROP INDEX "public"."idx_regularization_movement"`);
        await queryRunner.query(`DROP TABLE "regularization_logs"`);
        await queryRunner.query(`DROP INDEX "public"."idx_document_sequence_key"`);
        await queryRunner.query(`DROP TABLE "document_sequences"`);
        await queryRunner.query(`DROP INDEX "public"."idx_adj_line_request"`);
        await queryRunner.query(`DROP TABLE "adjustment_request_lines"`);
        await queryRunner.query(`DROP INDEX "public"."idx_adj_request_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."idx_adj_request_type_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_adj_request_code"`);
        await queryRunner.query(`DROP TABLE "adjustment_requests"`);
        await queryRunner.query(`DROP TABLE "alert_rules"`);
        await queryRunner.query(`DROP INDEX "public"."idx_items_factura_factura"`);
        await queryRunner.query(`DROP TABLE "items_factura"`);
        await queryRunner.query(`DROP TYPE "public"."items_factura_afectacioniva_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_facturas_cliente"`);
        await queryRunner.query(`DROP INDEX "public"."idx_facturas_fecha"`);
        await queryRunner.query(`DROP INDEX "public"."idx_facturas_estado"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7e7a73f09b393bb666a13441e"`);
        await queryRunner.query(`DROP TABLE "facturas"`);
        await queryRunner.query(`DROP TYPE "public"."facturas_estado_enum"`);
        await queryRunner.query(`DROP TYPE "public"."facturas_condicionpago_enum"`);
        await queryRunner.query(`DROP TYPE "public"."facturas_tipode_enum"`);
        await queryRunner.query(`DROP TABLE "clientes"`);
        await queryRunner.query(`DROP TYPE "public"."clientes_tipocontribuyente_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_document_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."idx_document_type_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_document_code"`);
        await queryRunner.query(`DROP TABLE "logistics_documents"`);
        await queryRunner.query(`DROP INDEX "public"."idx_lot_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_lot_product"`);
        await queryRunner.query(`DROP INDEX "public"."idx_lot_vencimiento"`);
        await queryRunner.query(`DROP TABLE "lots"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_detail_movement"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_detail_pallet"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_detail_lot"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_detail_location"`);
        await queryRunner.query(`DROP TABLE "movement_details"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_product"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_type_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_pallet"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_lot"`);
        await queryRunner.query(`DROP INDEX "public"."idx_movement_document"`);
        await queryRunner.query(`DROP TABLE "movements"`);
        await queryRunner.query(`DROP INDEX "public"."idx_sap_snapshot_date_product"`);
        await queryRunner.query(`DROP TABLE "sap_stock_snapshots"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pallet_current_location"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pallet_lot"`);
        await queryRunner.query(`DROP INDEX "public"."idx_pallet_status"`);
        await queryRunner.query(`DROP TABLE "pallets"`);
        await queryRunner.query(`DROP INDEX "public"."idx_attachment_entity"`);
        await queryRunner.query(`DROP TABLE "attachments"`);
        await queryRunner.query(`DROP INDEX "public"."idx_stock_product_warehouse_location"`);
        await queryRunner.query(`DROP INDEX "public"."idx_stock_product"`);
        await queryRunner.query(`DROP TABLE "stocks"`);
        await queryRunner.query(`DROP TABLE "transports"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."idx_doc_event_entity"`);
        await queryRunner.query(`DROP INDEX "public"."idx_doc_event_created_at"`);
        await queryRunner.query(`DROP TABLE "document_events"`);
        await queryRunner.query(`DROP TABLE "warehouses"`);
        await queryRunner.query(`DROP INDEX "public"."idx_location_zone"`);
        await queryRunner.query(`DROP TABLE "locations"`);
    }

}
