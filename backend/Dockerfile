# syntax=docker/dockerfile:1.7
# ---- build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- dev stage (used by docker-compose.override.yml)
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
USER 1001:1001
CMD ["npx", "tsx", "watch", "src/main.ts"]

# ---- runtime stage: distroless, non-root, read-only FS friendly
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist/compliance ./dist/compliance
COPY healthcheck.mjs ./healthcheck.mjs
COPY package.json ./package.json
ENV NODE_ENV=production
USER nonroot
EXPOSE 8080
CMD ["dist/main.js"]
