# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Railway passes service variables as build args automatically
ARG VITE_VAULT_ADDRESS
ENV VITE_VAULT_ADDRESS=$VITE_VAULT_ADDRESS
# Cache-bust: change this value to force a fresh build
ARG CACHE_BUST=2
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config as template (NOT in /etc/nginx/templates — we do envsubst manually)
COPY nginx.conf /etc/nginx/nginx.conf.template

ENV BACKEND_URL=backend.railway.internal:8000

EXPOSE 80

# Only substitute PORT and BACKEND_URL, leave Nginx variables ($host, $uri, etc.) untouched
CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
