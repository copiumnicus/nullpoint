# Single long-running process: the whole game world lives in memory and ticks at
# 30Hz, so this must never be scaled past one instance.
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
EXPOSE 3000

# /data should be a mounted volume; without one, accounts reset on every deploy.
VOLUME ["/data"]

CMD ["node", "server.js"]
