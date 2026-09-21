const crypto = require('crypto');

const VISITOR_SALT = process.env.VISITOR_HASH_SALT || process.env.JWT_SECRET || 'nexqira-visitor-salt';

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  // Take first IP if a forwarded-for chain, normalize IPv6-mapped IPv4.
  const first = raw.split(',')[0].trim();
  return first.replace(/^::ffff:/i, '');
}

function getClientIp(req) {
  return normalizeIp(req.headers['x-forwarded-for'] || req.ip);
}

function hashVisitor({ ip, userAgent, clientId }) {
  const base = clientId
    ? `client:${clientId}`
    : `ip-ua:${normalizeIp(ip)}:${String(userAgent || '').slice(0, 200)}`;
  return crypto.createHash('sha256').update(`${base}:${VISITOR_SALT}`).digest('hex');
}

module.exports = { normalizeIp, getClientIp, hashVisitor };
