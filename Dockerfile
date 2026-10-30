# The base image is pinned so that a rebuild of this container produces the
# same runtime; Dependabot opens the pull request that moves the pin.
FROM node:25.9.0-alpine3.23

WORKDIR /app

COPY . .

RUN npm config set registry https://registry.npmmirror.com \
  && npm install -g pnpm \
  && pnpm config set registry https://registry.npmmirror.com

RUN pnpm install

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]
