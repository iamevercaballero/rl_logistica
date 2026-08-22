import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { DataSource, type DataSourceOptions } from 'typeorm';

// Carga .env desde la raíz del repo (un nivel arriba de backend/) y del propio backend.
// Inocuo en runtime de Nest porque @nestjs/config ya pobló process.env.
loadEnv({ path: join(__dirname, '..', '..', '.env') });
loadEnv({ path: join(__dirname, '..', '.env') });
loadEnv();

const isCompiled = __filename.endsWith('.js');
const ext = isCompiled ? 'js' : 'ts';

export const databaseConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [join(__dirname, `**/*.entity.${ext}`)],
  migrations: [join(__dirname, `migrations/*.${ext}`)],
  migrationsTableName: 'typeorm_migrations',
  synchronize: false,
  // Fuerza la zona de la sesión en el connect en vez de confiar en el default
  // ambiente del servidor: en Windows + Docker Desktop (WSL2) verificamos que
  // una conexión TCP publicada (host → contenedor) y una conexión por socket
  // Unix (`docker exec`) pueden resolver un `TimeZone` de sesión DISTINTO para
  // el mismo Postgres, mismo rol, misma base — un backend con `pg_backend_pid()`
  // confirmado mostraba `America/Asuncion` (desde su propia sesión) mientras el
  // servidor, consultado por socket, ya tenía `Etc/GMT+3`. La causa exacta es
  // de la capa de red host↔WSL2↔contenedor, no de Postgres ni de la app — pero
  // sea cual sea la causa, no vale la pena confiar en el default del server.
  // `-c timezone=...` en `options` es el parámetro de arranque de libpq: cada
  // conexión nueva del pool queda en UTC-3 fijo sin importar por qué camino de
  // red llegó. Mismo valor que `Etc/GMT+3` en `common/date.ts` y docker-compose.
  extra: { options: '-c timezone=Etc/GMT+3' },
  logging:
    process.env.DB_LOGGING === 'true'
      ? ['query', 'error', 'warn']
      : ['error'],
};

// Un único export de DataSource: el CLI de TypeORM (migration:generate/run)
// exige exactamente una instancia de DataSource exportada en este archivo.
export const AppDataSource = new DataSource(databaseConfig);
