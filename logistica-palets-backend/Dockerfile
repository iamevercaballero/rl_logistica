FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# Alpine no trae la base de zonas horarias: sin esto `TZ=America/Asuncion` no
# tiene datos que leer y las fechas quedan a merced del ICU embebido en Node,
# que en esta versión todavía aplica el horario de verano que Paraguay derogó
# en 2024 — una hora menos en reportes y movimientos entre marzo y octubre.
# `src/common/date.ts` igual detecta el caso y cae a un offset fijo; esto es
# para que la zona IANA sea correcta de entrada.
RUN apk add --no-cache tzdata
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# dist incluye main.js + data-source.js + migrations/ + **/*.entity.js
COPY --from=builder /app/dist ./dist

# El proceso corre como `node` (uid 1000), no como root. Es el que recibe los
# archivos que sube un operador y todo el tráfico de la API: si algo lo
# compromete, root dentro del contenedor es un escalón de más que no hace falta
# regalar. La imagen de node ya trae ese usuario.
#
# El directorio de adjuntos se crea acá y con dueño `node` a propósito: cuando
# Docker crea un volumen nombrado vacío, copia el contenido Y el dueño del
# directorio de la imagen. Si no existiera con el dueño correcto, el volumen
# nacería de root y el backend no podría escribir un solo adjunto. Para un
# volumen que YA existe de un despliegue anterior hay que corregirlo a mano —
# está documentado en DEPLOY.md.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]