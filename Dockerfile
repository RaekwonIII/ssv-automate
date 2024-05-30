# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/engine/reference/builder/

FROM oven/bun:1.0.11-alpine as base
WORKDIR /home/bun/app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install
# RUN cd /temp/dev && bun install --frozen-lockfile

FROM base AS prerelease
WORKDIR /home/bun/app
COPY --chown=bun:bun --from=install /temp/dev/node_modules node_modules
COPY . .

RUN bun build index.ts --outdir ./out --target bun

FROM base AS release
WORKDIR /home/bun/app

COPY --chown=bun:bun --from=install /temp/dev/node_modules node_modules
COPY --chown=bun:bun --from=prerelease /home/bun/app/package.json .
COPY --chown=bun:bun --from=prerelease /home/bun/app/out/index.js .

# Run the application as a non-root user.
USER bun

# Copy the rest of the source files into the image.
# COPY --chown=bun:bun . .

# Run the application.
# CMD node index.js merge-deposit /output -t 0x095c832b78e1ef5dd1dd5793a1189e6c89efa1aac74e06eb7b768c3fbaf8b1dc

ENV NODE_ENV=production

ENV SUBGRAPH_API="https://api.studio.thegraph.com/query/71118/ssv-network-ethereum/version/latest"
ENV OUTPUT_FOLDER="output_data"
ENV NETWORK=mainnet
ENV SSV_API=https://api.ssv.network/api/v4/$NETWORK

# e2m
ENV E2M_API=https://e2m.ssv.network//api/stats
ENV E2M_CLUSTER_API=$E2M_API/validators?latest=10&minus=1&clusters=

# Rated
ENV RATED_API="https://api.rated.network/v0/eth"
ENV RATED_API_PARAMS="/validators/effectiveness?size=10&granularity=year&groupBy=timeWindow&indices="

# holesky
ENV DEPOSIT_CONTRACT="0x00000000219ab540356cBB839Cbe05303d7705Fa"
ENV SSV_CONTRACT="0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1"

ENTRYPOINT ["bun", "index.js"]
