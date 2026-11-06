FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
# The uploads volume must be writable by the non-root user; a named volume inherits this ownership on first use.
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
