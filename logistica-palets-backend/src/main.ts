import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { validateEnv } from './config/env.validation';
import { parseTrustProxy } from './common/client-ip';
import { corsOriginCallback } from './config/cors';

async function bootstrap() {
  // Fail-fast: en producción aborta si faltan secretos JWT (o son débiles).
  // Debe correr ANTES de crear la app para que ningún módulo use fallbacks.
  validateEnv();

  // bufferLogs: true ensures Pino captures early boot messages
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Replace NestJS default logger with Pino
  app.useLogger(app.get(Logger));

  // Detrás de un proxy (túnel de Cloudflare, Caddy, nginx) la conexión la abre
  // el proxy, así que sin esto `req.ip` es siempre la misma dirección para todos
  // los usuarios: el registro de accesos queda inservible y el límite de tasa
  // "por IP" pasa a ser un presupuesto compartido por toda la empresa.
  //
  // Se activa sólo con TRUST_PROXY declarado. No tiene default activo a
  // propósito: prendido donde el backend sí recibe conexiones directas,
  // cualquiera podría falsificar su IP con una cabecera y saltear el límite.
  const trustProxy = parseTrustProxy();
  if (trustProxy !== null) app.set('trust proxy', trustProxy);

  // Parse cookies (needed for HttpOnly refresh token)
  app.use(cookieParser());

  // Security HTTP headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
  app.use(helmet());

  app.setGlobalPrefix('api');

  // CORS: en producción restringido a CORS_ORIGIN (lista separada por coma);
  // si la variable está vacía (dev), se refleja cualquier origen.
  app.enableCors({ origin: corsOriginCallback, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  app.get(Logger).log(`RL Logística API escuchando en puerto ${port}`, 'Bootstrap');
}
void bootstrap();
