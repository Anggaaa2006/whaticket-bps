FROM node:22-bookworm as build-deps
WORKDIR /usr/src/app
COPY package*.json ./
COPY .npmr[c] ./
RUN npm install --legacy-peer-deps
COPY .env* ./
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.js ./
RUN CI=false npm run build

FROM nginx:stable
ENV PUBLIC_HTML=/var/www/public/
RUN apt-get update && apt-get install -y --no-install-recommends jq openssl wget ca-certificates && rm -rf /var/lib/apt/lists/*
ENV DOCKERIZE_VERSION v0.6.1
RUN wget -q https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && tar -C /usr/local/bin -xzvf dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz \
    && rm dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz
COPY .docker/nginx /etc/nginx/
COPY --from=build-deps /usr/src/app/build ${PUBLIC_HTML}
COPY .docker/add-env-vars.sh /docker-entrypoint.d/01-add-env-vars.sh
RUN chmod +x /docker-entrypoint.d/01-add-env-vars.sh