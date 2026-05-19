# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RL Logística** is a full-stack pallet/inventory logistics management system for AMBEV:
- **Backend**: NestJS + PostgreSQL + TypeORM (`logistica-palets-backend/`)
- **Frontend**: React 19 + TypeScript + Vite (`logistica-palets-frontend/`)
- **Infrastructure**: Docker Compose (root)

## Commands

### Backend (`logistica-palets-backend/`)
```bash
npm install
npm run start:dev       # dev server port 3000, watch mode
npm run build
npm start               # production
npm run lint            # eslint --fix
npm run start:debug     # with debugger
```

### Frontend (`logistica-palets-frontend/`)
```bash
npm install
npm run dev             # Vite dev server
npm run build           # tsc -b && vite build
npm run lint
npm run preview
```

### Docker (root)
```bash
docker compose up --build   # PostgreSQL (5433), backend (3000), frontend/nginx (5175)
```

## Architecture

### Data Flow
1. `POST /api/auth/login` → JWT returned
2. Frontend stores token in `localStorage`; axios interceptor (`api/client.ts`) attaches `Bearer` on every request
3. RBAC gates backend routes (`RolesGuard` + `@Roles()` decorator) and frontend routes (`RequireRole` in `main.tsx` using `auth/rbac.ts`)

### Core Domain Model

```
Product ──< Lot ──< Pallet
                     │ currentLocationId → Location → Warehouse
Stock (productId, warehouseId?, locationId?) ← updated atomically per movement
Movement ──< MovementDetail (per pallet line)
          └─ RegularizationLog (audit trail per field change)
```

- **Stock** is keyed by `(productId, warehouseId, locationId)` — all three columns are nullable. Use TypeORM `IsNull()` for null-equality in `findOne`, not `undefined`.
- **Pallet.currentLocationId** is the source of truth for where a pallet physically is. EXIT/TRANSFER stock math reads this field, not the form's warehouseId.
- **Lot.status** and **Movement.status** are both `NORMAL | PENDING_REGULARIZATION`. A provisional entry marks both as `PENDING_REGULARIZATION`; regularization resets both.
- **Pallet.status**: `AVAILABLE | EXITED | BLOCKED | DAMAGED | IN_TRANSIT`. Exited pallets cannot be re-dispatched; PENDING_REGULARIZATION lots block exit.

### Movement Types & Lifecycle

Types: `ENTRY`, `EXIT`, `TRANSFER`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`

**ENTRY**: increases Stock at (warehouseId, locationId). With `palletItems`: increases stock first (total), then per-pallet creates/finds Lot and creates Pallet records. `isProvisional=true` marks status PENDING_REGULARIZATION and requires non-empty `notes`.

**EXIT**: with `palletItems`, decreases stock from each pallet's `currentLocationId` (not the form's warehouseId). Sets `pallet.status = 'EXITED'`. Blocked if pallet's lot has `PENDING_REGULARIZATION`.

**TRANSFER**: per-pallet decreases from `pallet.currentLocationId`, increases at `toLocationId`, updates `pallet.currentLocationId = toLocationId`.

**ADJUSTMENT_IN/OUT**: requires `adjustmentReason` (enum: `DIFERENCIA_INVENTARIO | CONTEO_FISICO | MERMA | PERDIDA | ROTURA | SOBRANTE | OTRO`). Optional `adjustmentCategory`.

**Regularization** (`PATCH /movements/:id/regularize`): only on PENDING_REGULARIZATION movements. Updates allowed fields (documentNumber, supplier, carrier, driver, destination, notes, sapLot, fechaVencimiento, fechaFabricacion, proveedor), logs each changed field to `regularization_logs`, resets movement + associated lots to NORMAL. Requires ADMIN or MANAGER role.

### SAP Lot Code Formula
```typescript
// letter = A for 2001, B for 2002, ..., Z for 2026
`${String.fromCharCode(65 + (year - 2001))}${MM}${DD}08201`
// e.g. Z051308201 for 2026-05-13
```

### FEFO
`GET /lots/fefo` returns lots ordered by `fechaVencimiento ASC NULLS LAST` with embedded AVAILABLE pallets. Accepts `locationId` to scope pallets to a specific rack (used for transfers).

### Backend Module Layout (`logistica-palets-backend/src/modules/`)
- `movements/` — core business logic; all stock mutations run inside `DataSource.transaction()`. `MovementsService` owns `applyIncrease`/`applyDecrease` helpers that upsert the Stock row.
- `lots/` — CRUD + FEFO query; `findOrCreateLot` is called from MovementsService during ENTRY
- `stocks/` — read-side stock state; written only by MovementsService
- `reports/` — KPI aggregations, daily stock, SAP diff, trace by material
- `billing/` — electronic invoicing (Paraguay SIFEN): clients (`clientes`), invoices (`facturas`), XML generation (`XmlGeneratorService`), SIFEN submission (`SifenService`). Config via `EMISOR_*` and `FACTURA_*` env vars.
- `seed/` — data seeding endpoint (enabled when `ALLOW_SEED=true`)
- All other modules (`products`, `warehouses`, `locations`, `pallets`, `transports`, `users`, `auth`) are standard CRUD

Path alias: `@modules/*` → `src/modules/*` (tsconfig.json).  
Global prefix: `/api` (main.ts).  
Schema: TypeORM `synchronize: true` — entity changes apply on next boot, no migration files.

### Frontend Module Layout (`logistica-palets-frontend/src/`)
- `auth/AuthContext.tsx` — global auth state (token, user, role)
- `auth/rbac.ts` — `PERMS` table mapping each module to which roles can read/create/update/remove; use `canRead(module, role)` etc.
- `auth/RequireRole.tsx` — route guard; redirects to `/login` if unauthenticated, shows error if insufficient role
- `api/client.ts` — axios instance with JWT interceptor; each domain has its own API file
- `pages/` — one page per domain; `Movements.tsx` handles ENTRY/EXIT/TRANSFER/ADJUSTMENT with tabbed forms
- `pages/Reports.tsx` — tabs: Stock actual, Historial, Lotes & SAP, Pendientes (regularization queue), Control diario, SAP (diff upload), Trazabilidad
- `layouts/AppLayout.tsx` — shared nav shell

### RBAC Summary
| Role | Movements | Billing | Regularize |
|---|---|---|---|
| ADMIN | read/create | read/create/remove | yes |
| MANAGER | read/create | read/create | yes |
| OPERATOR | create only | — | — |
| AUDITOR | read only | read only | — |

Movements read access: ADMIN, MANAGER, AUDITOR only (OPERATOR cannot browse history — only submit).

### Environment Variables
Root `.env` (Docker + backend):
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE`, `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `EMISOR_RUC`, `EMISOR_DV`, `EMISOR_RAZON_SOCIAL`, `FACTURA_TIMBRADO`, `FACTURA_VIGENCIA`, `SIFEN_URL`
- `ALLOW_SEED=true` to enable seed endpoint

Frontend:
- `VITE_API_URL` — injected at build time by Vite (set to `http://localhost:3000/api` for Docker builds)
