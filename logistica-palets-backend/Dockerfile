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
EXPOSE 3000
CMD ["node", "dist/main.js"]