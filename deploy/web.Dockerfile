FROM node:22-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY web/package*.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY web ./
ENV API_ORIGIN=http://api:8000
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 API_ORIGIN=http://api:8000
COPY --from=build --chown=node:node /app /app
USER node
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]
