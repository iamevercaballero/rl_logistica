# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RL Logística** is a full-stack pallet/inventory logistics management system:
- **Backend**: NestJS + PostgreSQL + TypeORM (`/backend`)
- **Frontend**: React 19 + TypeScript + Vite (`/frontend`)
- **Infrastructure**: Docker Compose (root)

## Commands

### Backend (`/backend`)
```bash
npm install
npm run start:dev       # dev server on port 3000 with watch mode
npm run build
npm start               # production start
npm run lint            # eslint with --fix
npm run start:debug     # with debugger
```

### Frontend (`/frontend`)
```bash
npm install
npm run dev             # Vite dev server
npm run build           # tsc -b && vite build
npm run lint
npm run preview
```

### Docker (root)
```bash
docker compose up --build   # PostgreSQL (5433), backend (3000), frontend/nginx (5174)
```

## Architecture

### Data Flow
1. User authenticates via `POST /api/auth/login` → JWT returned
2. Frontend stores token in `localStorage`; axios interceptor attaches `Bearer` token on every request
3. Role-based access control (RBAC) gates both backend routes (NestJS guards) and frontend routes (`RequireRole` wrapper in `/frontend/src/main.tsx`)

### Core Domain Model
- **Products** (materials) → **Lots** (ManyToOne to Product) → **Pallets** (individual units with status/location)
- **Warehouses** → **Locations** (racks/floors within a warehouse)
- **Stock**: current quantity by Product + Warehouse + Location
- **Movements**: all inventory changes (ENTRY, EXIT, TRANSFER, ADJUSTMENT_IN, ADJUSTMENT_OUT, REPROCESS); each movement updates Stock transactionally

### Backend Module Layout (`/backend/src`)
- `auth/` — JWT + Passport, `@Roles()` decorator, `RolesGuard`
- `users/` — user management, bcrypt password hashing, role enum
- `movements/` — the core business logic: validates stock availability, runs DB transactions, updates stock atomically
- `stocks/` — read-side stock state per product/warehouse/location
- `reports/` — KPI aggregations and SAP stock export
- All other modules (`products`, `lots`, `warehouses`, `locations`, `pallets`, `transports`) are standard CRUD with TypeORM entities

Path alias: `@modules/*` maps to `src/modules/*` (configured in `tsconfig.json`).  
Global API prefix: `/api` (set in `main.ts`).

### Frontend Module Layout (`/frontend/src`)
- `auth/AuthContext.tsx` — global auth state (token, user, role)
- `api/client.ts` — axios instance; each domain has its own API file (e.g., `api/movements.ts`)
- `pages/` — one page per domain feature; Dashboard includes Recharts KPI charts
- `layouts/AppLayout.tsx` — shared nav shell

Roles: `Admin`, `Manager`, `Operator`, `Auditor`. Role checks use `RequireRole` in the router.

### Environment Variables
Backend and Docker read from a `.env` file at root/backend:
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `VITE_API_URL` (frontend only, injected at build time by Vite)
