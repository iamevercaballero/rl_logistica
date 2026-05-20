# Prompt Maestro: Escalado Profesional — RL Logística WMS

> **Rol:** Actúa como un **Arquitecto de Software Senior** con más de 10 años de experiencia en sistemas de warehouse management (WMS) empresariales, combinado con el conocimiento de un **UX Designer experto** especializado en software industrial B2B. Conoces en profundidad el proyecto **RL Logística** (NestJS + PostgreSQL + TypeORM + React 19 + TypeScript + Vite), su modelo de dominio (Product → Lot → Pallet, Stock, Movement, FEFO, SIFEN billing, RBAC de 4 roles), y el contexto de negocio: operación de almacenamiento logístico para AMBEV en Paraguay.
>
> Tu objetivo es elevar este proyecto al **nivel de un producto SaaS enterprise de clase mundial**, sin reescribir desde cero, sino evolucionando la base existente de manera incremental, justificada y priorizada.

---

## PARTE 1 — VISIÓN Y FILOSOFÍA DE DISEÑO

### 1.1 Design System Unificado

El CSS actual (tokens en `:root`, clases utilitarias en `index.css`) es una base sólida. Evoluciónalo a un **Design System documentado y versionado**:

- Extrae todos los tokens a un archivo `design-tokens.ts` tipado en TypeScript, que sirva tanto al CSS como a los componentes React (sin duplicación).
- Adopta una **escala tipográfica de 6 pasos** (12 / 13 / 14 / 16 / 20 / 26px) con line-height y letter-spacing definidos por paso.
- Escala de espaciado en múltiplos de 4px: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64.
- Define 3 niveles de elevación superficial explícitos: `surface-0` (fondo), `surface-1` (tarjeta), `surface-2` (modal/dropdown), `surface-3` (tooltip).
- Paleta semántica completa: `brand`, `success`, `warning`, `danger`, `info` — cada uno con variantes `subtle` (fondo), `base` (texto/borde), `solid` (botón).
- Sistema de **modo dual**: dark (actual) + light mode, activable desde el perfil de usuario, persistido en `localStorage` y sincronizado con `prefers-color-scheme`. Usar `data-theme` en el `<html>`.

### 1.2 Principios UX para Software Industrial B2B

Estos principios deben guiar **cada decisión** de diseño en el proyecto:

1. **Densidad de información controlada**: los operadores de almacén procesan centenares de registros por turno. Prioriza tablas densas con filtros rápidos sobre formularios largos.
2. **Zero-error UX**: toda acción destructiva (EXIT, ADJUSTMENT_OUT, regularización) requiere confirmación explícita con resumen del impacto antes de ejecutar.
3. **Estado visible en todo momento**: cada pantalla muestra el estado del sistema (última sincronización, alertas activas, movimientos pendientes) en el header.
4. **Feedback inmediato**: ninguna acción del usuario debe quedar sin respuesta visual en menos de 100ms — usa skeleton loaders, spinners inline y toasts contextuales.
5. **Teclado primero**: los operadores con alta carga operativa necesitan atajos de teclado para las acciones más frecuentes (registrar entrada, escanear palet, confirmar salida).
6. **Reversibilidad**: cuando sea posible, ofrece deshacer (soft-delete con ventana de 30 seg) en lugar de eliminar permanentemente.

---

## PARTE 2 — FRONTEND: ARQUITECTURA Y COMPONENTES

### 2.1 Estructura de Carpetas Objetivo

```
src/
├── design-system/
│   ├── tokens.ts          # Tokens tipados exportados como constantes
│   ├── components/        # Átomos y moléculas sin lógica de negocio
│   │   ├── Button/
│   │   ├── Badge/
│   │   ├── DataTable/
│   │   ├── Modal/
│   │   ├── Toast/
│   │   ├── Skeleton/
│   │   ├── CommandPalette/
│   │   └── ...
│   └── index.ts
├── features/              # Un directorio por dominio
│   ├── movements/
│   │   ├── components/    # Componentes específicos del dominio
│   │   ├── hooks/         # useMovements, useFefoLots, etc.
│   │   ├── api.ts         # Tipado fuerte de endpoints
│   │   └── types.ts
│   ├── dashboard/
│   ├── reports/
│   ├── billing/
│   └── ...
├── shared/
│   ├── hooks/             # useDebounce, useVirtualList, useHotkeys
│   ├── utils/
│   └── constants/
├── auth/                  # Sin cambios estructurales, solo refactor
└── main.tsx
```

### 2.2 Gestión de Estado y Data Fetching

**Reemplaza el patrón `useState + useEffect + fetch`** de cada página por **TanStack Query (React Query v5)**:

```typescript
// ANTES (patrón actual)
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
useEffect(() => { fetchData().then(setData).finally(...) }, []);

// DESPUÉS (objetivo)
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['movements', filters],
  queryFn: () => getMovements(filters),
  staleTime: 30_000,
  refetchOnWindowFocus: true,
});
```

Beneficios clave para este proyecto:
- **Cache automático**: navegar de Movements a Dashboard y volver no re-fetcha si los datos son frescos.
- **Optimistic updates**: al registrar un movimiento, actualiza la tabla local antes de que el servidor confirme.
- **Background refetch**: el Dashboard se actualiza cada 60s sin que el usuario lo pida.
- **Deduplicación**: si dos componentes piden el mismo endpoint simultáneamente, solo se hace un request.

Para mutaciones (POST/PATCH), usa `useMutation` con `onSuccess` que invalida el cache relevante:

```typescript
const { mutate: createEntry } = useMutation({
  mutationFn: createMovement,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['movements'] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
    queryClient.invalidateQueries({ queryKey: ['stock'] });
    toast.success('Entrada registrada correctamente');
  },
  onError: (error) => toast.error(getFriendlyApiError(error)),
});
```

**Estado global liviano**: usa **Zustand** solo para estado de UI transversal (theme, sidebar collapsed, command palette open, active filters persistidos entre navegaciones). Evita Zustand para datos del servidor — ese es el trabajo de React Query.

### 2.3 Componente DataTable Enterprise

La tabla actual (`.table` CSS class + map manual) debe reemplazarse por un componente `<DataTable>` reutilizable con:

- **Virtualización** (TanStack Virtual) para listas de más de 200 filas, sin paginación perceptible.
- **Sorting multi-columna** con indicadores visuales.
- **Filtros inline** sobre las columnas clave (tipo, estado, fecha, depósito).
- **Selección múltiple** con checkbox + acción batch (útil para exit de múltiples palets).
- **Column visibility toggle** — el usuario elige qué columnas ver, persistido en `localStorage`.
- **Export CSV/XLSX** desde el cliente, sin roundtrip al backend.
- **Sticky header** + **sticky primera columna** para tablas anchas.
- **Expand row**: al hacer click en una fila de Movements, se expande mostrando los MovementDetails sin navegar a otra página.

```typescript
<DataTable
  data={movements}
  columns={movementsColumns}
  loading={isLoading}
  selectable
  onSelectionChange={setSelectedIds}
  expandedRenderer={(row) => <MovementDetailExpanded id={row.id} />}
  toolbar={<MovementsToolbar />}
  emptyState={<EmptyMovements />}
/>
```

### 2.4 Sistema de Notificaciones

Implementa un **Toast System** centralizado (sin librerías externas pesadas — React Portal + animaciones CSS):

- Posición: `bottom-right`, stack vertical con animación slide-up.
- Tipos: `success`, `error`, `warning`, `info`, cada uno con ícono y color semántico.
- Duración: success=3s, error=6s (con botón "Cerrar"), warning=5s.
- **Acción opcional**: el toast de "Entrada registrada" incluye un botón "Ver movimiento" que navega directamente al registro.
- Accesible: `role="status"` para success/info, `role="alert"` para error/warning.

### 2.5 Command Palette (Ctrl+K / Cmd+K)

Una de las features de mayor impacto UX para usuarios avanzados. Implementa un command palette modal:

- Se abre con `Ctrl+K` / `Cmd+K` desde cualquier pantalla.
- Busca en tiempo real: páginas, acciones frecuentes, materiales (por código SAP), palets (por código), lotes.
- Acciones directas: "Nueva entrada", "Registrar salida", "Ir a Dashboard", "Ver pendientes regularización".
- Historial de las últimas 5 búsquedas en `localStorage`.
- Navegación completa con teclado (↑↓ Enter Escape).
- Usa el endpoint `GET /api/products?search=` y `GET /api/pallets?search=` existentes.

### 2.6 Pantalla de Movimientos — Rediseño UX

La página `Movements.tsx` actual tiene demasiado estado y responsabilidades. Divide en:

**Tab ENTRADA — Flujo guiado en 3 pasos (wizard):**
1. **Producto + Depósito + Documento** — selección con autocomplete, validación en tiempo real.
2. **Lotes y Palets** — tabla editable tipo spreadsheet: agregar filas con Enter, Tab entre campos, auto-generación de código SAP visible junto al campo.
3. **Confirmación** — resumen antes de enviar: "Vas a ingresar X palets del material Y en el depósito Z. ¿Confirmar?"

**Tab SALIDA — Búsqueda FEFO con UX mejorada:**
- Selector "buscar por producto" vs "buscar por lote SAP" con toggle más visible.
- Lista FEFO con indicadores de vencimiento (verde >60 días, amarillo 15-60 días, rojo <15 días).
- Palets seleccionables con checkbox, cantidad disponible visible.
- Preview del stock resultante después de la salida.

**Tab REGULARIZACIÓN — Vista dedicada con lista de pendientes y formulario lateral (split view).**

### 2.7 Dashboard — Nivel Enterprise

El Dashboard actual es funcional. Llévalo a nivel operativo real:

**Fila 1 — KPIs con tendencia:**
- Cada KPI card muestra el valor actual + delta respecto al período anterior (ej: "+12% vs semana pasada") con micro-flecha verde/roja.
- KPIs adicionales: palets por vencer en 15 días, movimientos pendientes de regularización, ocupación de depósito (%).

**Fila 2 — Mapa de calor de ubicaciones:**
- Grid visual del almacén: cada rack/posición coloreada por % de ocupación (vacío=gris, 25%=azul claro, 100%=azul intenso). Click en celda abre detalle de la ubicación.

**Fila 3 — Serie temporal de movimientos:**
- Gráfico de línea (Recharts LineChart) con entradas vs salidas por día/semana/mes. Permite comparar períodos.

**Fila 4 — Alertas operativas (panel lateral):**
- Lista priorizada: vencimientos próximos, palets en tránsito >48h, stock por debajo del mínimo configurado.

**Real-time con WebSocket:**
- El Dashboard escucha un WebSocket que emite eventos cuando se registra un movimiento. Al recibir el evento, actualiza los KPIs con un indicador visual parpadeante por 2 segundos antes de mostrar el nuevo valor.

---

## PARTE 3 — BACKEND: ARQUITECTURA Y ESCALABILIDAD

### 3.1 Migrations en lugar de `synchronize: true`

**Este es el cambio más crítico para producción.** El `synchronize: true` de TypeORM es peligroso — puede alterar o borrar datos con un deploy.

```typescript
// typeorm.config.ts — configuración de producción
export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  synchronize: false,             // NUNCA true en producción
  migrationsRun: true,            // Ejecuta migrations al arrancar
  migrations: ['dist/migrations/*.js'],
  migrationsTableName: 'typeorm_migrations',
  logging: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
};
```

Genera la primera migration desde el estado actual:
`npm run typeorm migration:generate -- -n InitialSchema`

### 3.2 Caché con Redis

Agrega Redis como capa de caché para queries frecuentes y costosas:

```typescript
@Get('kpis')
@UseInterceptors(CacheInterceptor)
@CacheTTL(60)   // 60 segundos
async getKpis(@Query() dto: KpisQueryDto) { ... }
```

Endpoints candidatos a caché: `GET /kpis`, `GET /stock`, `GET /reports/daily-stock`, `GET /lots/fefo` (TTL=30s).

Invalida el caché cuando `MovementsService` confirma un movimiento.

### 3.3 WebSockets — Eventos en Tiempo Real

```typescript
@WebSocketGateway({ namespace: '/events', cors: true })
export class EventsGateway {
  @WebSocketServer() server: Server;

  emitMovementCreated(movement: MovementSummary) {
    this.server.emit('movement:created', movement);
  }

  emitStockUpdated(warehouseId: string) {
    this.server.emit('stock:updated', { warehouseId });
  }
}
```

`MovementsService` inyecta `EventsGateway` y emite al final de cada transacción exitosa.

### 3.4 Structured Logging con Pino

```typescript
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'rl-logistica-backend', env: process.env.NODE_ENV },
});
```

Cada request loguea: `method`, `url`, `statusCode`, `responseTime`, `userId`, `role`.

### 3.5 Health Check Completo

```json
{
  "status": "ok",
  "timestamp": "2026-05-19T12:00:00Z",
  "uptime": 86400,
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "sifen": { "status": "degraded", "latencyMs": 2400, "note": "timeout" }
  }
}
```

### 3.6 Validación y Seguridad Reforzada

- **Rate limiting**: `@nestjs/throttler` — 100 req/min por IP en endpoints públicos, 5 intentos de login/min por IP.
- **Helmet**: headers de seguridad HTTP (HSTS, CSP, X-Frame-Options).
- **DTO validation estricta**: `whitelist: true, forbidNonWhitelisted: true` en `ValidationPipe` global.
- **Sanitización de inputs**: prevenir XSS en campos de texto libre (notes, documentNumber, etc.).
- **Refresh tokens**: HttpOnly cookie para sesiones de turno completo (8h) sin interrupciones.

### 3.7 Módulo de Auditoría Completo

```typescript
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() userId: number;
  @Column() action: string;      // 'MOVEMENT_CREATED' | 'STOCK_ADJUSTED' | 'USER_LOGIN'
  @Column() entityType: string;  // 'Movement' | 'Pallet' | 'Stock'
  @Column({ nullable: true }) entityId: string;
  @Column({ type: 'jsonb' }) before: Record<string, unknown>;
  @Column({ type: 'jsonb' }) after: Record<string, unknown>;
  @Column() ipAddress: string;
  @CreateDateColumn() createdAt: Date;
}
```

Un `AuditInterceptor` global captura automáticamente todos los POST/PATCH/DELETE.

---

## PARTE 4 — FEATURES DE NEGOCIO PREMIUM

### 4.1 Módulo de Alertas y Reglas de Negocio

Reglas configurables que disparan alertas:
- Stock de producto X en depósito Y cae por debajo de Z unidades → notificar a MANAGER.
- Palet con lote a vencer en menos de 15 días → aparecer en panel de alertas del Dashboard.
- Lote PENDING_REGULARIZATION por más de 48h → escalar a ADMIN.

Implementado con `@Cron` (NestJS Schedule) que evalúa reglas cada 15 minutos.

### 4.2 Escáner de Código de Barras / QR

- El campo "Buscar palet" acepta input de lector USB (comportamiento: teclado rápido + Enter).
- En dispositivos móviles, botón "Escanear" abre cámara usando `BarcodeDetector` API (fallback: `ZXing-js`).
- El código escaneado llama `GET /api/pallets?code=` y pre-selecciona el palet en el formulario.

### 4.3 Exportación y Reportes Avanzados

- **Export PDF**: `jsPDF` + `jspdf-autotable` en el cliente — historial con logo RL Logística.
- **Export Excel con formato condicional**: diferencias SAP con filas en rojo (>0) / verde (=0).
- **Email programado**: `@nestjs-modules/mailer` — reporte diario de stock a MANAGERs a las 7:00 AM.

### 4.4 PWA — Modo Offline

- `vite-plugin-pwa` con Workbox para cachear el shell y últimos datos conocidos.
- Banner "Datos offline — última actualización hace X minutos" cuando no hay red.
- Mutaciones encoladas en IndexedDB, sincronizadas al recuperar conectividad.
- Instalable en tablets de almacén como PWA (pantalla completa, sin barra del browser).

### 4.5 Trazabilidad Completa por Palet

```
Palet #PAL-2026-0412
──────────────────────────────────────────────────
  2026-05-01  ENTRADA       Depósito A / Rack R3-C2    Lote Z050108201
  2026-05-10  TRANSFERENCIA   R3-C2 → R1-C5            Operador: jlopez
  2026-05-15  SALIDA PARCIAL  -48 un                   Doc: REM-00412
  2026-05-19  EN STOCK        R1-C5 · 72 unidades
──────────────────────────────────────────────────
```

Implementado con `GET /api/pallets/:id/history` que une Movement, MovementDetail y RegularizationLog.

---

## PARTE 5 — INFRAESTRUCTURA Y DEVOPS

### 5.1 Docker Compose Producción

`docker-compose.prod.yml` con:
- **Redis** como nuevo servicio.
- **Backend** con `restart: unless-stopped`, `healthcheck`, secrets desde env.
- **Nginx** con gzip, cache de 1 año para assets hashed, rate limiting básico.
- **Postgres** con backup diario automatizado.

### 5.2 Variables de Entorno — Gestión Segura

`.env.example` completo con comentarios (nunca hardcodear secrets):

```bash
# Auth
JWT_SECRET=            # openssl rand -base64 64
JWT_EXPIRES_IN=8h
JWT_REFRESH_SECRET=    # diferente al JWT_SECRET
JWT_REFRESH_EXPIRES_IN=7d

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=        # REQUERIDO en producción

# Mailer
MAIL_HOST=smtp.sendgrid.net
MAIL_USER=apikey
MAIL_PASSWORD=         # SendGrid API key
REPORT_RECIPIENTS=gerencia@rl-logistica.com.py
```

### 5.3 Testing — Pirámide Completa

**1. Unit tests (Vitest) — Backend:**
- `MovementsService.applyIncrease/applyDecrease` — lógica de stock.
- `MovementsService.processEntry/Exit/Transfer` — casos edge (stock negativo, palet ya salido, lote pendiente).
- `XmlGeneratorService.generateXml` — factura Paraguay SIFEN.

**2. Integration tests (Supertest) — Backend:**
- Flujo completo ENTRY → EXIT: verifica stock antes y después.
- Flujo provisional → regularización: verifica status transitions.
- Auth + RBAC: verifica que OPERATOR no puede ver historial.

**3. E2E tests (Playwright) — Frontend:**
- Login → Dashboard carga KPIs.
- Registrar entrada → aparece en historial.
- Intentar salida de palet ya salido → error visible al usuario.

**Objetivo de cobertura inicial: 70% backend, 40% frontend (flujos críticos).**

---

## PARTE 6 — ACCESIBILIDAD Y PERFORMANCE

### 6.1 WCAG 2.1 AA — Checklist Prioritario

- **Contraste**: verificar todos los textos (el `--muted: #8c90a1` sobre `--bg: #131314` da 5.2:1 — correcto).
- **Focus visible**: `:focus-visible` con ring en todos los elementos interactivos. Añadir `outline-offset: 2px`.
- **Etiquetas ARIA**: todos los `<input>` y `<select>` con `<label>` asociado o `aria-label`.
- **Roles semánticos**: `<nav>`, `<main>`, `<aside>` con labels descriptivos.
- **Loading states**: skeleton loaders con `aria-busy="true"` y `role="status"`.
- **Errores de formulario**: asociados al input con `aria-describedby`.

### 6.2 Performance Frontend

- **Code splitting por ruta**: cada `page/` es un chunk con `React.lazy` + `Suspense`.
- **Memoización**: componentes de tabla con `React.memo`, funciones de columnas con `useMemo`.
- **Bundle target**: < 350KB gzip total. Auditar con `vite-bundle-visualizer`.
- **Imágenes**: logo con `loading="lazy"`, `width`/`height` explícitos, versión WebP.

### 6.3 Performance Backend

**Índices críticos de base de datos:**

```sql
CREATE INDEX idx_movement_detail_pallet   ON movement_detail(pallet_id);
CREATE INDEX idx_stock_product_warehouse  ON stock(product_id, warehouse_id);
CREATE INDEX idx_lot_status               ON lot(status);
CREATE INDEX idx_movement_date            ON movement(created_at DESC);
CREATE INDEX idx_pallet_current_location  ON pallet(current_location_id);
```

**Query optimization**: auditar queries N+1. El endpoint `GET /lots/fefo` con pallets embedded es candidato — usar `QueryBuilder` con joins explícitos en lugar de eager relations.

---
 
## PARTE 7 — ROADMAP PRIORIZADO

### Fase 1 — Fundamentos (2 semanas)
- [ ] Migrar a TypeORM migrations (`synchronize: false`)
- [ ] Implementar TanStack Query en todas las páginas
- [ ] Agregar índices de base de datos críticos
- [ ] Sistema de Toast notifications centralizado
- [ ] Dark/light mode toggle
- [ ] WCAG — focus visible y labels en todos los inputs

### Fase 2 — UX Operativo (2 semanas)
- [ ] DataTable component reutilizable con sort, filter y expand row
- [ ] Dashboard — KPIs con tendencia + alertas operativas
- [ ] Movimientos — wizard de 3 pasos para ENTRADA
- [ ] FEFO — indicadores de vencimiento por color
- [ ] Trazabilidad completa por palet (history endpoint + UI)
- [ ] Command Palette (Ctrl+K)

### Fase 3 — Infraestructura (2 semanas)
- [ ] Redis caché para KPIs y stock
- [ ] WebSockets — Dashboard en tiempo real
- [ ] Structured logging con Pino
- [ ] Health check endpoint completo
- [ ] Rate limiting + Helmet
- [ ] Refresh tokens

### Fase 4 — Features Premium (3 semanas)
- [ ] Exportación PDF y Excel avanzado
- [ ] Módulo de alertas configurables
- [ ] Email report diario automatizado
- [ ] Soporte de escáner de barras
- [ ] PWA / modo offline básico
- [ ] Test suite (unit + integration + E2E)

---
### Parte 8  gestionar el .env que no sea visible al subir al repositorio y Tener en cuenta que el proyecto lo quiero trabajar en VPS, tengo pensando el siguiente roadmap, pero debes de ajustar segun sea lo mejor para el contexto de proyecto
## Fase 1 — Preparar el proyecto
.env.prod
.env.test
docker-compose.prod.yml
docker-compose.test.yml
variables correctas
seed bloqueado en producción
DB no pública
## Fase 2 — Preparar VPS
Ubuntu Server
Docker
Docker Compose
Firewall
SSH seguro
Nginx/Traefik
SSL
## Fase 3 — Desplegar test
test.tudominio.com
api-test.tudominio.com
BD test
## Fase 4 — Desplegar producción
app.tudominio.com
api.tudominio.com
BD prod
backups diarios
## Fase 5 — Operación real
CI/CD
monitoreo
logs
alertas
documentación
plan de recuperación 
