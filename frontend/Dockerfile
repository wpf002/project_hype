# ── Stage 1: build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# VITE_API_URL is a build-time arg.
# - docker-compose local: leave empty → nginx proxies /api/* to backend
# - Railway production:   set to backend's Railway public URL
#   e.g. https://project-hype-backend.up.railway.app
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────
# nginxinc/nginx-unprivileged runs as a non-root user (uid 101) out of the box
# and listens on port 8080 by default, eliminating the root-master-process issue.
# The PORT env var is injected by Railway; local docker-compose uses the default.
FROM nginxinc/nginx-unprivileged:1.31-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# Copy as a template — PORT is substituted at container start
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Default port for local docker-compose; Railway overrides with its own $PORT.
# Must be ≥1024 since we run unprivileged (no CAP_NET_BIND_SERVICE).
ENV PORT=8080
EXPOSE 8080

# envsubst '$PORT' replaces only PORT, leaving nginx vars ($host etc.) intact
CMD ["sh", "-c", "envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
