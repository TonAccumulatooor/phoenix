FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# The agent runs as a long-lived process (Teleton plugin)
# It needs PHOENIX_AGENT_API_KEY and BACKEND_URL at runtime
ENV BACKEND_URL=http://backend.railway.internal:8000

CMD ["node", "index.js"]
