FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 LIVE_TRADING_ENABLED=false ORDER_EXECUTION_ENABLED=false
EXPOSE 8787
CMD ["node", "src/server.js"]
