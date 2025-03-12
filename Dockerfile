###############################################################################
###############################################################################
##                      _______ _____ ______ _____                           ##
##                     |__   __/ ____|  ____|  __ \                          ##
##                        | | | (___ | |__  | |  | |                         ##
##                        | |  \___ \|  __| | |  | |                         ##
##                        | |  ____) | |____| |__| |                         ##
##                        |_| |_____/|______|_____/                          ##
##                                                                           ##
## description     : Dockerfile for TsED Application                         ##
## author          : TsED team                                               ##
## date            : 2023-12-11                                              ##
## version         : 3.0                                                     ##
##                                                                           ##
###############################################################################
###############################################################################

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /opt

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.*.json .barrels.json .swcrc ./

ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm store prune

COPY ./src ./src

RUN pnpm build

FROM node:${NODE_VERSION}-alpine AS runtime
ENV WORKDIR /opt
WORKDIR $WORKDIR

# RUN apk add build-base git curl
RUN npm install -g pm2

COPY --from=build /opt .

ENV COREPACK_INTEGRITY_KEYS=0
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --prod \
  && pnpm store prune

COPY . .

EXPOSE 8081
ENV PORT=8081 \
  NODE_ENV=production

CMD ["pm2-runtime", "start", "processes.config.cjs", "--env", "production"]
