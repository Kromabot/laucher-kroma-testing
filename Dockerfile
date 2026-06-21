FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .

FROM base AS api
ENV NODE_ENV=production
RUN npm --workspace apps/api run prisma:generate
EXPOSE 3001
CMD ["npm", "--workspace", "apps/api", "run", "start"]

FROM base AS bot
ENV NODE_ENV=production
CMD ["npm", "--workspace", "apps/bot", "run", "start"]

FROM base AS web-build
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm --workspace apps/web run build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/docker/web.nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
