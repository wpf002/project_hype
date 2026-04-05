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
FROM nginx:1.27-alpine

COPY --from=builder /app/dist /usr/share/nginx/html
# Copy as a template — PORT is substituted at container start
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Default port for local docker-compose; Railway overrides with its own $PORT
ENV PORT=80
EXPOSE 80

# envsubst '$PORT' replaces only PORT, leaving nginx vars ($host etc.) intact
CMD ["sh", "-c", "envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
