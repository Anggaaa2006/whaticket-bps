FROM node:22-bookworm as build-deps

RUN apt-get update && apt-get install -y wget ffmpeg gnupg ca-certificates     && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb     && apt-get install -y ./google-chrome-stable_current_amd64.deb       fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-freefont-ttf libxss1       --no-install-recommends     && rm -f google-chrome-stable_current_amd64.deb     && rm -rf /var/lib/apt/lists/*

ENV DOCKERIZE_VERSION v0.6.1
RUN wget -q https://github.com/jwilder/dockerize/releases/download/$DOCKERIZE_VERSION/dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz     && tar -C /usr/local/bin -xzvf dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz     && rm dockerize-linux-amd64-$DOCKERIZE_VERSION.tar.gz

ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.1/dumb-init_1.2.1_amd64 /usr/local/bin/dumb-init
RUN chmod +x /usr/local/bin/dumb-init

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true
ENV PUPPETEER_SKIP_DOWNLOAD true

WORKDIR /usr/src/app
COPY package*.json .npmrc ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:stable
COPY --from=build-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=build-deps /usr/local/bin/dockerize /usr/local/bin/dockerize
COPY --from=build-deps /usr/local/bin/dumb-init /usr/local/bin/dumb-init
COPY --from=build-deps /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
WORKDIR /usr/src/app
COPY --from=build-deps /usr/src/app /usr/src/app

ENV NODE_ENV=production
ENV PORT=8080
ENV CHROME_BIN=/usr/bin/google-chrome-stable

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD dockerize -wait tcp://${DB_HOST}:3306 -timeout 60s \
  && npx sequelize db:migrate \
  && node dist/server.js