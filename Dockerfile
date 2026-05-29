ARG BUN_IMAGE=oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
FROM ${BUN_IMAGE}

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

EXPOSE 8787

CMD ["bun", "run", "payer:http"]
