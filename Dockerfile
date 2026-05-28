ARG BUN_IMAGE=oven/bun:1-alpine
FROM ${BUN_IMAGE}

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

EXPOSE 8787

CMD ["bun", "run", "payer:http"]
