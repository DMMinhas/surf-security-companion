# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
COPY . .
# Vite inlines VITE_* at build time; the root .env is runtime-only, so the
# values must arrive as build args (wired up in docker-compose.yml).
ARG VITE_OIDC_ISSUER_URL
ARG VITE_OIDC_CLIENT_ID
ARG VITE_API_BASE
ARG VITE_OTEL_EXPORTER_OTLP_ENDPOINT
ENV VITE_OIDC_ISSUER_URL=$VITE_OIDC_ISSUER_URL \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_API_BASE=$VITE_API_BASE \
    VITE_OTEL_EXPORTER_OTLP_ENDPOINT=$VITE_OTEL_EXPORTER_OTLP_ENDPOINT
RUN npm run build

FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js index.html ./
COPY src ./src
USER 1001:1001
CMD ["npx", "vite", "--host", "0.0.0.0"]

# Static file server (nginx at the edge proxies to this)
FROM node:22-alpine AS runtime
RUN npm install -g serve@14 && adduser -D -u 1001 app
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY healthcheck.mjs ./healthcheck.mjs
USER 1001:1001
EXPOSE 8081
CMD ["serve", "-s", "dist", "--listen", "tcp://0.0.0.0:8081", "--no-clipboard"]
