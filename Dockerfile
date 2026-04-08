FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npm test
RUN node dist/cli.js --help
RUN echo "--- Blackbox: search ---" && node dist/cli.js search || true
RUN echo "--- Blackbox: list ---" && node dist/cli.js list || true
RUN echo "--- Blackbox: doctor ---" && node dist/cli.js doctor
RUN echo "--- Blackbox: env check ---" && node dist/cli.js env check
RUN echo "--- Blackbox: pack (no pkg) ---" && node dist/cli.js pack nonexistent 2>&1 || true
RUN echo "--- Blackbox: install (no pkg) ---" && node dist/cli.js install nonexistent 2>&1 || true
