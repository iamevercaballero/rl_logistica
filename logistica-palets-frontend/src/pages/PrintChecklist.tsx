import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getDocumentChecklist,
  type ChecklistData,
  type ChecklistLotRow,
} from "../api/movements";
import { formatDateOnly } from "../utils/dateFormat";
import { fmtQtyFixed } from "../utils/number";
import {
  CHECKLIST_IR_ROWS,
  irBlockGoesOnOwnPage,
  materialFillerRows,
  paginateChecklistLots,
  type ChecklistLotPage,
} from "./printChecklistModel";

/**
 * CHECKLIST DE RECEPCIÓN DE INSUMOS — reproducción imprimible del formulario
 * "Condiciones de Recepciones de Insumos" del cliente, solo para Entradas.
 *
 * Los datos que RL Logística ya tiene se autocompletan; los controles de
 * inspección física (puntos 17, 18, 19 y 23) salen en blanco a propósito: se
 * llenan a mano sobre la hoja durante la descarga.
 *
 * Es independiente de PrintDocument/PrintLabels (otro formulario, otra grilla),
 * pero comparte las utilidades de fecha y número y el logo del proyecto.
 */

const FORM_TITLE = "Condiciones de Recepciones de Insumos";

/** Punto 17 — inspección visual del móvil. Se completa a mano. */
const TRUCK_INSPECTION = [
  "Paletas desordenadas",
  "Presencia de humedad en el interior del móvil",
  "Paletas muy juntas (apretadas)",
  "Malas condiciones del móvil (mal encarpado, agrietado, piso/techo roto etc). Especificar detalladamente la no conformidad",
];

/** Punto 18 — estado físico de las paletas. Se completa a mano. */
const PALLET_INSPECTION = [
  "Paletas Deformadas",
  "Paletas Rotas",
  "Paletas Mojadas",
  "Paletas Sucias",
  "Paletas con defectos de films cubre pallet",
  "Paletas con defectos de tensión de films cubre pallet",
];

/** Punto 19 — estado de los insumos. Se completa a mano. */
const SUPPLY_INSPECTION = ["Rotas / Golpeadas", "Faltantes", "Sucias", "Mojadas"];

const NON_CONFORMING_HEADER = "Cantidad de paletas No Conformes/N° de Etiqueta de la paleta";

/**
 * Punto 25 — texto del cliente, transcrito del formulario original. Son
 * instrucciones impresas del procedimiento, no reglas que el sistema valide.
 */
const DECISION_RULES = [
  'Si durante el control se encuentran Paletas No conformes (rotas, mojadas, con excesiva cantidad de abolladas) se debe colocar en el MIC un sello de "Carga NOOK" en el que se detallará:',
  "** Cantidad de Paletas no conformes detallando el defecto.",
  "** Nombre y firma de la persona responsable de la descarga.",
  "** Nombre y firma del chofer del camión afectado.",
  "** Adjuntar fotos como evidencia para los reclamos correspondientes",
  "En todos los casos se deben registrar en el Check List los datos de la carga (Nº de Remito, N° de MIC, N° de Etiqueta de la paleta afectada, Nombre y firma del Chofer, Chapa del camión (ambas chapas), Lote proveedor, cantidad de Insumos dañados y motivo de retención si correspondiera).",
  "En caso de encontrarse con una paleta No conforme se debe anexar una copia del Check List al MIC.",
  "Todos los datos deben ser enviados al proveedor dentro de las 24hs.",
];

/**
 * Encabezado repetido en todas las hojas del formulario.
 *
 * "Codigo" y "Fecha" son el control documental del cliente y en la planilla
 * original vienen en blanco: se dejan igual, no se rellenan con el código del
 * remito. El RLNE va en una fila propia — la hoja tiene que ser rastreable
 * hasta la Entrada que la generó, sobre todo al reimprimirla.
 */
function SheetHeader({ code }: { code: string }) {
  return (
    <div className="ck-header">
      <img src="/logo.jpg" alt="" className="ck-header-logo" />
      <div className="ck-header-title">{FORM_TITLE}</div>
      <div className="ck-header-meta">
        <div className="ck-header-meta-row">
          <span className="ck-header-meta-key">Codigo</span>
          <span className="ck-header-meta-val" />
        </div>
        <div className="ck-header-meta-row">
          <span className="ck-header-meta-key">Fecha</span>
          <span className="ck-header-meta-val" />
        </div>
        <div className="ck-header-meta-row">
          <span className="ck-header-meta-key">RLNE</span>
          <span className="ck-header-meta-val">{code}</span>
        </div>
      </div>
    </div>
  );
}

/** Bloque de firmas físicas (puntos 26 y 36). No hay firma digital. */
function Signatures({ responsible }: { responsible?: string }) {
  return (
    <div className="ck-signatures">
      <div className="ck-sig">
        <div className="ck-sig-line" />
        <div className="ck-sig-label">Firma del Chofer</div>
        <div className="ck-sig-line ck-sig-line--second" />
        <div className="ck-sig-label">Aclaración</div>
      </div>
      <div className="ck-sig">
        <div className="ck-sig-line" />
        <div className="ck-sig-label">Firma del Responsable de Recepción</div>
        <div className="ck-sig-line ck-sig-line--second" />
        <div className="ck-sig-label">Aclaración</div>
        {/* Preimpreso como referencia: la aclaración se firma igual a mano. */}
        {responsible && <div className="ck-sig-prefill">{responsible}</div>}
      </div>
    </div>
  );
}

/** Un renglón numerado de la cabecera (puntos 1 a 16). */
function FieldRow({ n, label, value, children }: {
  n: number;
  label: string;
  value?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <tr>
      <td className="ck-num">{n}</td>
      <td className="ck-label">{label}</td>
      <td className="ck-value">{children ?? value ?? " "}</td>
    </tr>
  );
}

/**
 * Cabecera Si / No / No conformes de los puntos 17, 18 y 19. El número va en
 * una celda que abarca todo el bloque, como en el formulario original — por eso
 * la cabecera vive dentro del mismo `tbody` (un `rowSpan` no cruza `thead`).
 */
function InspectionTable({ n, title, items }: { n: number; title: string; items: string[] }) {
  return (
    <table className="ck-table ck-inspection">
      <tbody>
        <tr>
          <th className="ck-num" rowSpan={items.length + 1}>{n}</th>
          <th className="ck-insp-title">{title}</th>
          <th className="ck-insp-mark">Si</th>
          <th className="ck-insp-mark">No</th>
          <th className="ck-insp-nc">{NON_CONFORMING_HEADER}</th>
        </tr>
        {items.map((item) => (
          <tr key={item}>
            <td className="ck-insp-item">- {item}</td>
            {/* Vacíos a propósito: se marcan físicamente en la descarga. */}
            <td className="ck-insp-mark" />
            <td className="ck-insp-mark" />
            <td className="ck-insp-nc" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Tabla de los puntos 22 y 23 (mismas columnas; la 23 va siempre vacía).
 * `leadNumber` es la celda numerada de la izquierda que abarca todo el bloque,
 * como la columna B del formulario original.
 */
function LotTable({ rows, fillerRows, leadNumber }: {
  rows: ChecklistLotRow[];
  fillerRows: number;
  leadNumber?: number;
}) {
  return (
    <table className="ck-table ck-lots">
      <tbody>
        <tr>
          <th className="ck-num" rowSpan={rows.length + fillerRows + 1}>{leadNumber ?? " "}</th>
          <th className="ck-lot-material">MATERIAL</th>
          <th className="ck-lot-code">LOTE PROVEEDOR</th>
          <th className="ck-lot-date">FABRICACIÓN</th>
          <th className="ck-lot-date">VENCIMIENTO</th>
          <th className="ck-lot-qty">CANTIDAD TOTAL</th>
          <th className="ck-lot-pal">PALETAS</th>
        </tr>
        {rows.map((row, index) => (
          <tr key={`${row.productId}-${row.lotId ?? "sin-lote"}-${index}`}>
            <td className="ck-lot-material">
              {row.productCode} - {row.productDescription}
            </td>
            <td className="ck-lot-code">{row.lotCode ?? " "}</td>
            <td className="ck-lot-date">{row.fechaFabricacion ? formatDateOnly(row.fechaFabricacion) : " "}</td>
            <td className="ck-lot-date">{row.fechaVencimiento ? formatDateOnly(row.fechaVencimiento) : " "}</td>
            <td className="ck-lot-qty">
              {fmtQtyFixed(row.quantity)}
              {row.unitOfMeasure ? ` ${row.unitOfMeasure}` : ""}
            </td>
            <td className="ck-lot-pal">{row.pallets}</td>
          </tr>
        ))}
        {Array.from({ length: fillerRows }).map((_, index) => (
          <tr key={`filler-${index}`}>
            <td className="ck-lot-material">&nbsp;</td>
            <td className="ck-lot-code" />
            <td className="ck-lot-date" />
            <td className="ck-lot-date" />
            <td className="ck-lot-qty" />
            <td className="ck-lot-pal" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Punto 23 — siempre en blanco, es un apartado de carga manual. */
function IrBlock() {
  return (
    <>
      <div className="ck-section-head">
        <span className="ck-section-num">23</span>
        <span className="ck-section-title">DETALLES DE PALETAS IR</span>
      </div>
      <LotTable rows={[]} fillerRows={CHECKLIST_IR_ROWS} />
    </>
  );
}

/** Página 2 del formulario y sus continuaciones. */
function LotSheet({ page, data, withIrBlock }: {
  page: ChecklistLotPage;
  data: ChecklistData;
  withIrBlock: boolean;
}) {
  return (
    <div className="ck-sheet">
      <SheetHeader code={data.document.code} />
      <div className="ck-section-head">
        <span className="ck-section-num">21</span>
        <span className="ck-section-title">
          LOTES POR PALETAS{page.continuation ? " — CONTINUACIÓN" : ""}
        </span>
      </div>
      <LotTable rows={page.rows} fillerRows={page.fillerRows} leadNumber={22} />
      {withIrBlock && <IrBlock />}
      <div className="ck-spacer" />
      <Signatures responsible={data.receptionResponsible} />
    </div>
  );
}

export default function PrintChecklistPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["print-checklist", documentId],
    queryFn: () => getDocumentChecklist(documentId!),
    enabled: !!documentId,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [data]);

  if (isLoading) {
    return <div className="ck-fallback">Cargando checklist...</div>;
  }
  if (isError || !data) {
    const message =
      (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      "Error cargando el checklist.";
    return <div className="ck-fallback ck-fallback--error">{message}</div>;
  }

  return (
    <>
      <style>{CHECKLIST_CSS}</style>

      <div className="print-controls">
        <button className="btn-print" onClick={() => window.print()}>🖨 Imprimir</button>
        <button className="btn-close" onClick={() => window.close()}>Cerrar</button>
        <span className="print-controls-label">
          {data.document.code} — CHECKLIST DE RECEPCIÓN DE INSUMOS
        </span>
      </div>

      <ChecklistSheets data={data} />
    </>
  );
}

/**
 * Las hojas del formulario, sin fetching ni controles de pantalla: recibe el
 * checklist ya resuelto y solo lo dibuja.
 */
export function ChecklistSheets({ data }: { data: ChecklistData }) {
  const pages = useMemo(() => paginateChecklistLots(data.lots), [data.lots]);
  const irOnOwnPage = useMemo(() => irBlockGoesOnOwnPage(pages), [pages]);
  const { document: doc, summary, materials, consistency } = data;

  return (
    <>
      {/* ── PÁGINA 1 ── */}
      <div className="ck-sheet">
        <SheetHeader code={doc.code} />

        {!consistency.ok && (
          /* No se altera ningún dato para que cuadre: la hoja sale marcada
             para que nadie la firme como si estuviera conciliada. */
          <div className="ck-warning">
            <strong>ATENCIÓN — verificar antes de firmar:</strong>
            <ul>
              {consistency.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}

        <div className="ck-top-row">
          <div className="ck-top-field">
            <span className="ck-top-key">FECHA:</span>
            <span className="ck-top-val">{formatDateOnly(doc.date)}</span>
          </div>
          <div className="ck-top-field">
            {/* Sin dato en el sistema: se completa a mano. */}
            <span className="ck-top-key">CAMIÓN N°:</span>
            <span className="ck-top-val ck-top-val--blank" />
          </div>
        </div>

        <table className="ck-table ck-fields">
          <tbody>
            <FieldRow n={1} label="Proveedor" value={doc.supplier} />
            {/* El formulario dice "N° de Factura"; en la Entrada es MIC/Factura/Remito. */}
            <FieldRow n={2} label="N° de Factura" value={doc.documentNumber} />
            {/* Punto 3: no se copia del remito aunque a veces coincidan. */}
            <FieldRow n={3} label="N° de MIC" value={doc.micNumber} />
            <FieldRow n={4} label="País" value={doc.originCountry} />
            <FieldRow n={5} label="Producto" value={summary.productDisplay} />
            <FieldRow n={6} label="Lote del Proveedor" value={summary.lotDisplay} />
            <FieldRow n={7} label="Protocolo de Calidad">
              {/* Se marca físicamente: no se infiere del sistema. */}
              <span className="ck-check-group">
                <span className="ck-check-label">SI</span>
                <span className="ck-check-box" />
                <span className="ck-check-label">NO</span>
                <span className="ck-check-box" />
              </span>
            </FieldRow>
            <FieldRow
              n={8}
              label="Fecha de fabricación"
              value={formatSummaryDate(summary.fabricationDisplay)}
            />
            <FieldRow
              n={9}
              label="Fecha de vencimiento"
              value={formatSummaryDate(summary.expirationDisplay)}
            />
            <FieldRow n={10} label="Lote Ypane" value={summary.sapLotDisplay} />
            <FieldRow n={11} label="Fecha de Arribo" value={formatDateOnly(doc.arrivalDate)} />
            <FieldRow n={12} label="Fecha de Descarga" value={formatDateOnly(doc.unloadDate)} />
            <FieldRow n={13} label="Cantidad de paletas" value={String(summary.totalPallets)} />
            <FieldRow n={14} label="Camion / N° Chapa" value={doc.vehiclePlate} />
            <FieldRow n={15} label="Nombre y Apellido del Chofer" value={doc.driver} />
            <FieldRow n={16} label="Nombre de Transportadora" value={doc.carrier} />
          </tbody>
        </table>

        <InspectionTable n={17} title="Inspección Visual del Camión o Contenedor" items={TRUCK_INSPECTION} />
        <InspectionTable n={18} title="Paletas" items={PALLET_INSPECTION} />
        <InspectionTable n={19} title="Insumos (observar las caras laterales de los pallets)" items={SUPPLY_INSPECTION} />

        {/* ── PUNTO 20: una fila por material, con sus lotes agrupados ── */}
        <table className="ck-table ck-materials">
          <tbody>
            <tr>
              <th className="ck-num" rowSpan={materials.length + materialFillerRows(materials) + 1}>20</th>
              <th className="ck-mat-oc">OC</th>
              <th className="ck-mat-code">Código de Material</th>
              <th className="ck-mat-qty">Cantidad</th>
              <th className="ck-mat-detail">Detalle</th>
            </tr>
            {materials.map((material) => (
              <tr key={material.productId}>
                {/* OC: la Entrada no registra orden de compra — se completa a mano. */}
                <td className="ck-mat-oc" />
                <td className="ck-mat-code">{material.code}</td>
                <td className="ck-mat-qty">
                  {fmtQtyFixed(material.totalQuantity)}
                  {material.unitOfMeasure ? ` ${material.unitOfMeasure}` : ""}
                </td>
                <td className="ck-mat-detail">{material.description}</td>
              </tr>
            ))}
            {Array.from({ length: materialFillerRows(materials) }).map((_, index) => (
              <tr key={`mat-filler-${index}`}>
                <td className="ck-mat-oc">&nbsp;</td>
                <td className="ck-mat-code" />
                <td className="ck-mat-qty" />
                <td className="ck-mat-detail" />
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── PUNTO 25: reglas del cliente, contenido estático ── */}
        <div className="ck-rules">
          <div className="ck-rules-title">Reglas de Decisión Recepción de Insumos</div>
          <div className="ck-rules-body">
            {DECISION_RULES.map((rule) => <p key={rule}>{rule}</p>)}
          </div>
        </div>

        <div className="ck-spacer" />
        <Signatures responsible={data.receptionResponsible} />
      </div>

      {/* ── PÁGINA 2 y continuaciones ── */}
      {pages.map((page, index) => (
        <LotSheet
          key={page.index}
          page={page}
          data={data}
          withIrBlock={!irOnOwnPage && index === pages.length - 1}
        />
      ))}

      {irOnOwnPage && (
        <div className="ck-sheet">
          <SheetHeader code={doc.code} />
          <IrBlock />
          <div className="ck-spacer" />
          <Signatures responsible={data.receptionResponsible} />
        </div>
      )}
    </>
  );
}

/**
 * Las fechas de la cabecera pueden traer "VER DETALLES" en lugar de una fecha:
 * ese texto se imprime tal cual, solo se formatea lo que es fecha calendario.
 */
function formatSummaryDate(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDateOnly(value) : value;
}

/** Estilos del formulario. Van con `ChecklistSheets`: sin ellos no hay grilla. */
export const CHECKLIST_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { color: #000; }
  body { font-family: Arial, Helvetica, sans-serif; background: #e0e0e0; font-size: 9px; }

  .ck-fallback { display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; }
  .ck-fallback--error { color: #b91c1c; padding: 0 24px; text-align: center; }

  .print-controls {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 24px; background: #1a1a2e; color: #fff;
    position: sticky; top: 0; z-index: 10;
  }
  .print-controls button { padding: 7px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 700; }
  .print-controls-label { font-size: 13px; color: #aaa; }
  .btn-print { background: #4f46e5; color: #fff; }
  .btn-close { background: transparent; color: #ccc; border: 1px solid #555 !important; }

  /* ── Hoja A4 ── */
  .ck-sheet {
    width: 210mm; min-height: 297mm;
    margin: 16px auto; background: #fff;
    padding: 7mm 8mm;
    box-shadow: 0 2px 12px rgba(0,0,0,0.2);
    display: flex; flex-direction: column;
  }

  /* ── Encabezado ── */
  /* Alto fijo: el logo se ajusta adentro en vez de estirar la banda y comerse
     el espacio que necesitan los 20 puntos del formulario. */
  .ck-header { display: flex; align-items: stretch; border: 1.5px solid #000; margin-bottom: 2mm; height: 15mm; }
  .ck-header-logo { width: 32mm; height: 100%; object-fit: contain; padding: 1mm 2mm; border-right: 1.5px solid #000; }
  .ck-header-title {
    flex: 1; display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 900; text-align: center; padding: 1mm;
  }
  .ck-header-meta { width: 40mm; border-left: 1.5px solid #000; display: flex; flex-direction: column; }
  .ck-header-meta-row { flex: 1; display: flex; align-items: center; border-bottom: 1px solid #000; font-size: 8px; }
  .ck-header-meta-row:last-child { border-bottom: none; }
  .ck-header-meta-key { width: 12mm; padding: 0 1mm; border-right: 1px solid #000; align-self: stretch; display: flex; align-items: center; }
  .ck-header-meta-val { flex: 1; padding: 0 1mm; font-family: monospace; font-size: 8px; font-weight: 700; }

  .ck-warning {
    border: 1.5px solid #000; background: #f2f2f2; padding: 1.5mm 2mm; margin-bottom: 2mm; font-size: 8px;
  }
  .ck-warning ul { margin: 0.5mm 0 0 4mm; }

  /* ── FECHA / CAMIÓN N° ── */
  .ck-top-row { display: flex; gap: 10mm; margin-bottom: 2mm; }
  .ck-top-field { display: flex; align-items: baseline; gap: 2mm; flex: 1; }
  .ck-top-key { font-size: 12px; font-weight: 900; }
  .ck-top-val { font-size: 12px; font-weight: 700; flex: 1; border-bottom: 1px solid #000; min-height: 5mm; }
  .ck-top-val--blank { border-bottom: 1px dotted #000; }

  /* ── Tablas ── */
  .ck-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .ck-table th, .ck-table td { border: 1px solid #000; padding: 0.35mm 1.2mm; vertical-align: middle; }
  .ck-num { width: 7mm; text-align: center; font-weight: 900; font-size: 11px; }

  /* Puntos 1 a 16 */
  .ck-fields { margin-bottom: 1.5mm; }
  .ck-fields .ck-label { width: 60mm; font-weight: 700; font-size: 10px; }
  .ck-fields .ck-value { font-size: 10.5px; font-weight: 700; height: 4.7mm; }
  .ck-check-group { display: inline-flex; align-items: center; gap: 2mm; }
  .ck-check-label { font-weight: 700; }
  .ck-check-box { display: inline-block; width: 4.5mm; height: 3.4mm; border: 1px solid #000; }

  /* Puntos 17, 18 y 19 */
  .ck-inspection { margin-bottom: 1.5mm; }
  .ck-inspection th { font-weight: 900; }
  .ck-insp-title { text-align: left; font-size: 9.5px; }
  .ck-insp-item { font-size: 8.5px; padding-left: 3mm; }
  .ck-insp-mark { width: 11mm; text-align: center; font-size: 9.5px; }
  .ck-insp-nc { width: 60mm; font-size: 7px; font-weight: 700; }
  .ck-inspection tbody td { height: 3.5mm; }

  /* Punto 20 */
  .ck-materials { margin-bottom: 1.5mm; }
  .ck-materials th { font-weight: 900; font-size: 9px; text-align: center; }
  .ck-materials td { height: 4.2mm; font-size: 9px; }
  .ck-mat-oc { width: 20mm; }
  .ck-mat-code { width: 34mm; font-family: monospace; font-weight: 700; }
  /* Ancho medido con la cantidad más larga posible ("1.234.567,891 KG"): la
     cifra nunca debe partirse en dos renglones en una hoja que se firma. */
  .ck-mat-qty { width: 33mm; text-align: right; font-weight: 700; }

  /* Punto 25 */
  .ck-rules { border: 1.5px solid #000; margin-bottom: 1.5mm; }
  .ck-rules-title { text-align: center; font-weight: 900; font-size: 10.5px; padding: 0.6mm; border-bottom: 1.5px solid #000; }
  .ck-rules-body { padding: 1mm 2mm; font-size: 7px; line-height: 1.22; }
  .ck-rules-body p { margin-bottom: 0.4mm; }

  /* ── Página 2: secciones 21, 22 y 23 ── */
  .ck-section-head { display: flex; align-items: stretch; border: 1.5px solid #000; border-bottom: none; }
  .ck-section-num { width: 7mm; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 11px; border-right: 1px solid #000; }
  .ck-section-title { flex: 1; text-align: center; font-weight: 900; font-size: 12px; padding: 1mm; }

  .ck-lots th { font-weight: 900; font-size: 8px; text-align: center; }
  .ck-lots td { height: 5.2mm; font-size: 9px; }
  /* Las columnas de ancho fijo se ajustan a su contenido real (un código de
     lote, una fecha, un conteo) para dejarle a MATERIAL todo lo que sobra: es
     la única que tiene texto largo y la que decide cuántos renglones ocupa la
     fila, y por lo tanto cuántos lotes entran por hoja. */
  .ck-lot-material { width: auto; }
  .ck-lot-code { width: 22mm; font-family: monospace; font-weight: 700; text-align: center; }
  .ck-lot-date { width: 19mm; text-align: center; }
  .ck-lot-qty { width: 33mm; text-align: right; font-weight: 700; }
  .ck-lot-pal { width: 13mm; text-align: center; font-weight: 700; }
  /* Descripciones largas: cortan de renglón en vez de romper la grilla. */
  .ck-lots .ck-lot-material { word-break: break-word; line-height: 1.15; }

  /* ── Firmas ── */
  .ck-spacer { flex: 1; min-height: 3mm; }
  .ck-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; padding: 0 4mm; }
  .ck-sig-line { border-top: 1px solid #000; margin-top: 7mm; }
  .ck-sig-line--second { margin-top: 6mm; }
  .ck-sig-label { text-align: center; font-size: 9.5px; padding-top: 0.6mm; }
  .ck-sig-prefill { text-align: center; font-size: 8px; padding-top: 0.4mm; }

  @media print {
    body { background: #fff; }
    .print-controls { display: none !important; }
    .ck-sheet {
      margin: 0; box-shadow: none; width: 100%; min-height: auto; height: 281mm;
      padding: 0; break-after: page; page-break-after: always;
    }
    .ck-sheet:last-child { break-after: auto; page-break-after: auto; }
    .ck-table { break-inside: auto; }
    .ck-table tr { break-inside: avoid; page-break-inside: avoid; }
    @page { size: A4 portrait; margin: 8mm; }
  }
`;
