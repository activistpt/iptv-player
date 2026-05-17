# IPTV Player Web - Self-Hosted com Proxy CORS
# Baseado em IPTV-Restream + custom player UI
# Suporte: M3U, Xtream Codes, CORS Proxy

FROM node:20-alpine

WORKDIR /app

# Instalar dependências do sistema
RUN apk add --no-cache curl

# Copiar package.json e instalar deps
COPY package.json .
RUN npm install --production

# Copiar código fonte
COPY . .

# Expor porta
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Iniciar
CMD ["node", "server.js"]
