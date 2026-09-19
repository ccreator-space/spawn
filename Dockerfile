FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.5.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && CI=true pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
WORKDIR /app
RUN groupadd -g 10001 app && useradd -m -u 10001 -g app app && mkdir -p /app/data && chown app:app /app/data
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/dist-web ./dist-web
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
