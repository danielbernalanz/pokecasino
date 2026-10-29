'use strict';
// Filtro de red: por defecto solo se aceptan conexiones desde redes privadas/VPN.
const { NETWORK_MODE, ALLOW_CIDRS } = require('./config');

function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inCidr(ip, cidr) {
  const [base, bitsStr] = cidr.split('/');
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return ip === base;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

const PRIVATE_V4 = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'];

function normalize(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function isAllowed(rawIp) {
  if (NETWORK_MODE === 'any') return true;
  const ip = normalize(rawIp);
  if (ALLOW_CIDRS.some((c) => inCidr(ip, c))) return true;
  if (ip.includes(':')) {
    const low = ip.toLowerCase();
    return low === '::1' || /^f[cd]/.test(low) || /^fe[89ab]/.test(low);
  }
  return PRIVATE_V4.some((c) => inCidr(ip, c));
}

module.exports = { isAllowed, normalize, inCidr };
