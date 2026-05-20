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
  logging:
    process.env.DB_LOGGING === 'true'
      ? ['query', 'error', 'warn']
      : ['error'],
};

export const AppDataSource = new DataSource(databaseConfig);
export default AppDataSource;
