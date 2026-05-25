# ══════════════════════════════════════════════════════
#  Varolyn Healthcare — Multi-stage Docker Build
# ══════════════════════════════════════════════════════

# ── Stage 1: Build React frontend ─────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY web/app/package.json web/app/package-lock.json* ./
RUN npm ci --production=false 2>/dev/null || npm install
COPY web/app/ ./
RUN npm run build

# ── Stage 2: Production server ────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 -S varolyn && adduser -S varolyn -u 1001 -G varolyn

# Install server dependencies
COPY server/package.json server/package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy server code
COPY server/index.js server/kalman.js ./

# Copy built frontend into server/public
COPY --from=frontend-build /build/dist ./public

# Own everything by non-root user
RUN chown -R varolyn:varolyn /app

USER varolyn

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

EXPOSE 8080

CMD ["node", "index.js"]
