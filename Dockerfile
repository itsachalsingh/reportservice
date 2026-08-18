# ==========================
# Stage 1: Dependencies
# ==========================
FROM node:20-alpine AS dependencies

WORKDIR /app

# Copy dependency files first for better cache
COPY package*.json ./

# Install dependencies
RUN npm install --frozen-lockfile

# ==========================
# Stage 2: Production Image
# ==========================
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -S nodeapp && adduser -S nodeapp -G nodeapp

# Copy node_modules from dependency stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application code
COPY . .

# Change ownership
RUN chown -R nodeapp:nodeapp /app

# Run as non-root
USER nodeapp

EXPOSE 3009

CMD ["node", "src/index.js"]