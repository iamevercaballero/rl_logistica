# Backend logística de palets (NestJS + PostgreSQL)

## Requisitos

- Node.js LTS
- npm o yarn
- PostgreSQL

## Pasos iniciales

```bash
# instalar dependencias
npm install

# variables de entorno (crear archivo .env en la raíz)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=logistica_palets

# levantar en desarrollo
npm run start:dev
```

La API escuchará en `http://localhost:3000/api`.

A partir de esta base vamos a ir agregando:

- Entidades TypeORM (productos, lotes, pallets, depósitos, etc.)
- Autenticación JWT y roles
- Endpoints de movimientos (entradas, salidas, transferencias)
- Reportes y vistas para integración con Power BI.
```
