FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store CI=true pnpm install --frozen-lockfile
RUN pnpm run build

FROM base AS runtime
WORKDIR /app

# 只從 build 階段複製必要檔案
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/example ./apps/example
COPY --from=build /app/packages ./packages

# 安裝正式環境依賴
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --filter "@mi-gpt/example..."

WORKDIR /app/apps/example
CMD ["node", "app.js"]
