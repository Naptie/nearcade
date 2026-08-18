FROM node:lts-alpine3.21

WORKDIR /app

COPY . .

RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com

RUN pnpm install

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]
