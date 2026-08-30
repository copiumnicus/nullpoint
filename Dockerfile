# Single long-running process: the whole game world lives in memory and ticks at
# 30Hz, so this must never be scaled past one instance.
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# No VOLUME directive: Railway rejects a Dockerfile that declares one and fails
# the build outright. Mount the volume at /data on the service instead — config.js
# looks there first and falls back to the repo's own folders, so this image runs
# the same from a checkout as it does from a mount.

CMD ["node", "server.js"]
