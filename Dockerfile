FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
# En la nube el acceso se limita con invitaciones; el filtro de IP privada no aplica.
ENV NETWORK_MODE=any TRUST_PROXY=1 DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
