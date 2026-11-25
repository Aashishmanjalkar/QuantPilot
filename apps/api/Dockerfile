# Build context: repository root.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @quantpilot/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /repo/apps/api
ENV NODE_ENV=production
USER node
EXPOSE 4000
# Apply pending migrations, then serve (M1: single API instance). Binaries run directly so
# the non-root user never needs corepack to fetch pnpm at startup.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx src/server.ts"]
