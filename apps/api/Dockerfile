FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY tsconfig.base.json ./

RUN npm install --workspaces --include-workspace-root

COPY apps/api ./apps/api

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app /app
WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
CMD ["npx", "tsx", "src/server.ts"]
