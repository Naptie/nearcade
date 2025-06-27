FROM node:18-alpine AS runner

WORKDIR /app

COPY . .

RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com

RUN pnpm install

EXPOSE 3000

ENV NODE_ENV=production

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "3000"]
