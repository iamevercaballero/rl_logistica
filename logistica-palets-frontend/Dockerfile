FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# Imagen sin privilegios: el master de nginx corre como uid 101 y no como root.
# En la imagen oficial el master ES root (solo los workers bajan a `nginx`), asi
# que una vulnerabilidad en el master daba root dentro del contenedor.
#
# Escucha en 8080 y no en 80: un proceso sin privilegios no puede tomar un
# puerto por debajo de 1024 sin CAP_NET_BIND_SERVICE, y agregar de vuelta esa
# capacidad para conservar el numero de puerto no vale la pena. El puerto es
# interno de la red del compose; quien lo publica es el tunel.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]