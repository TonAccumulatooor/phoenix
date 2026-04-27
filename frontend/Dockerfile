# Stage 1: Build
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config template
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Railway sets PORT; Nginx needs BACKEND_URL to proxy API calls
# BACKEND_URL should be the internal Railway service URL, e.g. backend.railway.internal:8000
ENV BACKEND_URL=backend.railway.internal:8000

EXPOSE 80

# envsubst replaces ${BACKEND_URL} in the nginx template at startup
CMD ["nginx", "-g", "daemon off;"]
