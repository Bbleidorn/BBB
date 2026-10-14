FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Render setzt PORT automatisch (Standard 10000)
EXPOSE 10000
CMD ["node", "server.js"]
