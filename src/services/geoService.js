// backend/src/services/geoService.js
const axios = require('axios');
const geoip = require('geoip-lite');
const IpGeoCache = require('../models/IpGeoCache');

function getHeaderLocation(req) {
  return {
    country: String(req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || ''),
    region: String(req.headers['x-vercel-ip-country-region'] || ''),
    city: String(req.headers['x-vercel-ip-city'] || ''),
    timezone: String(req.headers['x-vercel-ip-timezone'] || '')
  };
}

function geoipLookup(ip) {
  const geo = geoip.lookup(ip);
  if (!geo) return {};
  return {
    country: geo.country || '',
    region: geo.region || '',
    city: geo.city || '',
    postal: geo.metro ? String(geo.metro) : '',
    latitude: geo.ll?.[0],
    longitude: geo.ll?.[1],
    timezone: geo.timezone || ''
  };
}

async function fetchIpinfo(ip) {
  const token = String(process.env.IPINFO_TOKEN || '').trim();
  if (!token) return null;
  try {
    const { data } = await axios.get(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      params: { token },
      timeout: 1500
    });
    if (!data) return null;
    const [latitude, longitude] = String(data.loc || '').split(',').map(Number);
    return {
      country: data.country || '',
      region: data.region || '',
      city: data.city || '',
      postal: data.postal || '',
      latitude: Number.isFinite(latitude) ? latitude : undefined,
      longitude: Number.isFinite(longitude) ? longitude : undefined,
      timezone: data.timezone || ''
    };
  } catch {
    return null;
  }
}

// Resolution order: hosting/CDN geo headers (free, no lookup) -> per-IP cache ->
// ipinfo.io (only if IPINFO_TOKEN is set) -> local geoip-lite database (always available).
async function resolveLocation(req, ip) {
  const header = getHeaderLocation(req);
  if (header.city || header.country) return { ...header, source: 'header' };

  const cached = await IpGeoCache.findOne({ ip }).lean().catch(() => null);
  if (cached) return { ...cached.location, source: cached.source };

  const ipinfoResult = await fetchIpinfo(ip);
  if (ipinfoResult) {
    await IpGeoCache.findOneAndUpdate(
      { ip },
      { location: ipinfoResult, source: 'ipinfo', fetchedAt: new Date() },
      { upsert: true }
    ).catch(() => {});
    return { ...ipinfoResult, source: 'ipinfo' };
  }

  const fallback = geoipLookup(ip);
  await IpGeoCache.findOneAndUpdate(
    { ip },
    { location: fallback, source: 'geoip-lite', fetchedAt: new Date() },
    { upsert: true }
  ).catch(() => {});
  return { ...fallback, source: 'geoip-lite' };
}

module.exports = { resolveLocation, getHeaderLocation };
