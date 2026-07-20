FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Install all deps (dev deps needed for the TypeScript build + prisma generate).
COPY package.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Generate the Prisma client (harmless if DATABASE_URL is unset at runtime),
# compile TypeScript, then drop dev deps to slim the image. The generated
# client under node_modules/.prisma survives the prune.
RUN npx prisma generate || true
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
