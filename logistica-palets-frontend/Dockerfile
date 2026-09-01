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
# Hashes de los <script> inline, para la CSP. El porque, en el propio script.
RUN node scripts/csp-script-hashes.mjs

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
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/csp-script-hashes.txt /tmp/csp-script-hashes.txt

# La CSP necesita saber a que origenes puede hablar el navegador, y son los
# mismos que el build ya inyecta en la app. Se resuelven aca en vez de dejar la
# politica comentada "hasta conocer el dominio", que es como quedo apagada desde
# el principio.
#
# Se agrega la forma `wss://` ademas de la `https://`: para la CSP son esquemas
# distintos, y el WebSocket no conectaria con solo el https.
#
# El `grep` final es una comprobacion, no un adorno: si el placeholder quedara
# sin sustituir, la CSP saldria rota y el build tiene que fallar ahi y no en
# produccion.
ARG VITE_API_URL
ARG VITE_WS_URL
USER root
RUN set -eu; \
    origen() { echo "$1" | sed -E 's#^([a-z]+://[^/]+).*#\1#'; }; \
    API="$(origen "$VITE_API_URL")"; \
    WS="$(origen "$VITE_WS_URL")"; \
    WSS="$(echo "$WS" | sed -E 's#^https://#wss://#; s#^http://#ws://#')"; \
    CONNECT="$(echo "$API $WS $WSS" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"; \
    sed -i "s#__CONNECT_SRC__#${CONNECT}#" /etc/nginx/security-headers.conf; \
    HASHES="$(cat /tmp/csp-script-hashes.txt)"; \
    sed -i "s#__SCRIPT_HASHES__#${HASHES}#" /etc/nginx/security-headers.conf; \
    rm -f /tmp/csp-script-hashes.txt; \
    if grep -qE '__CONNECT_SRC__|__SCRIPT_HASHES__' /etc/nginx/security-headers.conf; then \
      echo 'ERROR: quedo un placeholder sin sustituir en la CSP'; exit 1; \
    fi; \
    grep -o "connect-src[^\"]*" /etc/nginx/security-headers.conf
USER 101

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
