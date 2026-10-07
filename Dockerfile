FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json vitest.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY manifests ./manifests
RUN pnpm install --frozen-lockfile
RUN pnpm prisma:generate && pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable
COPY --from=build /app /app
ENV NODE_ENV=production
