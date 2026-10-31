# Maybe Lite: one image serving the API and the built web app on :3001.
# The build stage only emits JavaScript and static files, so it runs on the builder's own CPU even when the image targets arm64.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY server server
COPY web web
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
WORKDIR /app
# bash + postgres client tools are what scripts/db/backup.sh needs ("Back up now" in Settings, and cron)
RUN apk add --no-cache bash postgresql16-client
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY scripts scripts
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "server/dist/index.js"]
