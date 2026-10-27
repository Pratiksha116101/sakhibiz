FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY dist ./dist
RUN mkdir -p /app/uploads/products && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
