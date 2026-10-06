# Coolify / Docker para Next.js 16 (standalone)
#
# Es el mismo esquema que el de `D:\webs\wweb`, y a propósito: dos
# servicios con dos Dockerfiles que se parecen son dos servicios que se
# comportan igual cuando algo falla.
#
# Lo que cambia respecto al del bot está marcado con ⚠️ y son decisiones
# de ESTE servicio, no de la plataforma.

FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Solo el manifiesto primero. Así la capa de dependencias se cachea y un
# cambio en un `.tsx` no reinstala los 300 MB de node_modules.
#
# ⚠️  ESTA COPIA FALLA SI NO HAY package-lock.json
# -----------------------------------------------
# `npm ci` exige el lock. Y falla con un error que habla de "package-lock
# not found" en medio de la compilación de Docker, tres minutos después
# de que empezara, que es la peor forma de enterarse.
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `.env*` está en el `.dockerignore`: Coolify las inyecta como variables
# de entorno, y no como ficheros.
#
# ⚠️  LAS VARIABLES NEXT_PUBLIC_* SE HORNEAN AQUÍ
# -----------------------------------------------
# `NEXT_PUBLIC_PANEL_URL` se sustituye al compilar y acaba DENTRO del
# JavaScript que baja el navegador. Si la cambiás después, hay que
# reconstruir la imagen: el contenedor nuevo sirve el bundle viejo.
#
# Es la trampa clásica de Next en Docker, y no da ningún error: la app
# levanta perfectamente y los enlaces "vuelvo al panel" apuntan al
# sitio anterior.
RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# ⚠️  HOSTNAME ES OBLIGATORIO
# -------------------------
# Sin esto, Next escucha en `localhost` dentro del contenedor, que es la
# interfaz de loopback del propio contenedor. Coolify llega desde fuera,
# no desde loopback, y el resultado es un contenedor que está arriba y no
# responde a nada: el health check falla y el log no dice por qué.
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Solo lo necesario para arrancar. `node_modules` entero no viene, que es
# justo lo que hace `standalone`.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]