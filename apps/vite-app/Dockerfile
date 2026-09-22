FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_AUTH_MODE
ARG VITE_DEV_AUTH_TOKEN
ARG VITE_OIDC_AUTHORITY
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_OIDC_POST_LOGOUT_REDIRECT_URI
ARG VITE_OIDC_SCOPE
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_DEV_AUTH_TOKEN=$VITE_DEV_AUTH_TOKEN \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
    VITE_OIDC_POST_LOGOUT_REDIRECT_URI=$VITE_OIDC_POST_LOGOUT_REDIRECT_URI \
    VITE_OIDC_SCOPE=$VITE_OIDC_SCOPE
RUN npm install -g pnpm
# 复制 monorepo 根配置和 lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/vite-app/ ./apps/vite-app/
RUN pnpm install --frozen-lockfile --filter vite-app...
WORKDIR /app/apps/vite-app
RUN pnpm build

FROM nginx:1.27-alpine
COPY apps/vite-app/nginx.conf /etc/nginx/nginx.conf.template
COPY --from=builder /app/apps/vite-app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["/bin/sh", "-c", "export LIVEKIT_UPSTREAM=$(echo $LIVEKIT_UPSTREAM | sed 's|^wss://|https://|; s|^ws://|http://|'); envsubst '$LIVEKIT_UPSTREAM' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
