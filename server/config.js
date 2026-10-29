'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const cfgFile = path.join(DATA_DIR, 'config.json');
let stored = {};
try { stored = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch { /* primera ejecución */ }

// Clave maestra de invitación: se genera una vez y se guarda si no se define por entorno.
if (!stored.accessKey) {
  stored.accessKey = crypto.randomBytes(6).toString('hex').toUpperCase();
  fs.writeFileSync(cfgFile, JSON.stringify(stored, null, 2));
}

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DATA_DIR,
  ACCESS_KEY: process.env.ACCESS_KEY || stored.accessKey,
  // OPEN_REGISTRATION=1: cualquiera puede crear cuenta sin código de invitación.
  OPEN_REGISTRATION: process.env.OPEN_REGISTRATION === '1',
  // private: solo LAN / VPN (Tailscale, ZeroTier, loopback) · any: sin filtro de IP
  NETWORK_MODE: process.env.NETWORK_MODE || 'private',
  // Rangos extra permitidos, separados por comas (p. ej. "203.0.113.7/32")
  ALLOW_CIDRS: (process.env.ALLOW_CIDRS || '').split(',').map((s) => s.trim()).filter(Boolean),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  // Saltos de proxy de confianza: cuántas entradas de X-Forwarded-For (contando desde la derecha) añaden nuestros proxies.
  // 1 = solo Render (se toma la última entrada); las de la izquierda las puede falsificar el cliente.
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY === '1' ? Math.max(1, Math.floor(Number(process.env.TRUST_PROXY_HOPS)) || 1) : 0,
  START_COINS: 5000,
  MIN_BET: 10,
  MAX_BET: 100000,
};
