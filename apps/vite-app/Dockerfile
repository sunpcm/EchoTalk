FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
# 复制 monorepo 根配置和 lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/vite-app/ ./apps/vite-app/
RUN pnpm install --frozen-lockfile --filter vite-app...
WORKDIR /app/apps/vite-app
RUN pnpm build

FROM nginx:alpine
COPY apps/vite-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/vite-app/dist /usr/share/nginx/html
EXPOSE 80
