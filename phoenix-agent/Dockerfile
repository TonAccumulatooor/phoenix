FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Standalone runner polls backend every 30s for selling migrations
# Required env vars: PHOENIX_AGENT_MNEMONIC, PHOENIX_AGENT_API_KEY
ENV BACKEND_URL=http://backend.railway.internal:8000

CMD ["node", "runner.js"]
