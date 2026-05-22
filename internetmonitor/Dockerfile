# Stage 1: build frontend + compile native backend modules
FROM node:22-alpine AS builder

ARG BUILD_ARCH=amd64

RUN apk add --no-cache python3 make g++

# Build frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Compile backend (native modules like better-sqlite3 need build tools)
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci --only=production

# Stage 2: lean runtime image
FROM node:22-alpine

ARG BUILD_ARCH=amd64

RUN apk add --no-cache bash iputils curl ca-certificates

# Install Ookla Speedtest CLI using the HA build arch arg (safe for cross-compilation)
RUN case "$BUILD_ARCH" in \
      amd64)   SPEEDTEST_ARCH="x86_64"  ;; \
      aarch64) SPEEDTEST_ARCH="aarch64" ;; \
      armv7)   SPEEDTEST_ARCH="armhf"   ;; \
      *)       SPEEDTEST_ARCH="x86_64"  ;; \
    esac && \
    curl -fsSL "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-${SPEEDTEST_ARCH}.tgz" \
      | tar xz -C /usr/local/bin speedtest \
    || echo "Ookla speedtest not available — Python fallback will be used"

# Python fallback (speedtest-cli)
RUN apk add --no-cache python3 py3-pip && \
    pip3 install --break-system-packages speedtest-cli 2>/dev/null || true

WORKDIR /app

# Copy compiled node_modules from builder
COPY --from=builder /build/backend/node_modules ./node_modules

# Copy backend source
COPY backend/src ./src

# Copy built frontend
COPY --from=builder /build/frontend/dist ./frontend/dist

RUN mkdir -p /data

COPY run.sh /
RUN chmod +x /run.sh

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_PATH=/app/frontend/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/status || exit 1

CMD ["/run.sh"]
