// backend/src/controllers/analyticsController.js
const crypto = require('crypto');
const geoip = require('geoip-lite');
const Visitor = require('../models/Visitor');

const VISITOR_SALT = process.env.VISITOR_HASH_SALT || process.env.JWT_SECRET || 'nexqira-visitor-salt';

function todayUTC(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function normalizeIp(ip) {
  const raw = String(ip || '').trim();
  // Take first IP if a forwarded-for chain, normalize IPv6-mapped IPv4.
  const first = raw.split(',')[0].trim();
  return first.replace(/^::ffff:/i, '');
}

function hashVisitor({ ip, userAgent, clientId }) {
  const base = clientId
    ? `client:${clientId}`
    : `ip-ua:${normalizeIp(ip)}:${String(userAgent || '').slice(0, 200)}`;
  return crypto.createHash('sha256').update(`${base}:${VISITOR_SALT}`).digest('hex');
}

function parseDevice(userAgent = '') {
  const ua = String(userAgent);
  const type = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'Mobile' : /Windows|Macintosh|Linux|CrOS/i.test(ua) ? 'Desktop' : 'Unknown';
  const os = /Windows NT/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Firefox\//i.test(ua) ? 'Firefox' : /CriOS\//i.test(ua) ? 'Chrome (iOS)' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : 'Unknown';
  return { type, os, browser };
}

function getHeaderLocation(req) {
  return {
    country: String(req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || ''),
    region: String(req.headers['x-vercel-ip-country-region'] || ''),
    city: String(req.headers['x-vercel-ip-city'] || ''),
    timezone: String(req.headers['x-vercel-ip-timezone'] || '')
  };
}

function resolveLocation(req, ip) {
  const headerLocation = getHeaderLocation(req);
  if (headerLocation.city || headerLocation.country) return headerLocation;
  const geo = geoip.lookup(ip);
  if (!geo) return headerLocation;
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

function dateRange(query) {
  const range = {};
  if (query.from) range.$gte = new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`);
  if (query.to) range.$lte = new Date(`${String(query.to).slice(0, 10)}T23:59:59.999Z`);
  return Object.keys(range).length ? range : null;
}

// Public: called once per session from the website to record an anonymous visit.
const trackVisit = async (req, res) => {
  try {
    const clientId = String(req.body?.clientId || '').trim().slice(0, 100) || null;
    const path = String(req.body?.path || '').trim().slice(0, 300);
    const ip = normalizeIp(req.headers['x-forwarded-for'] || req.ip);
    const userAgent = req.get('user-agent');

    const visitorHash = hashVisitor({ ip, userAgent, clientId });
    const day = todayUTC();

    const existing = await Visitor.findOne({ ip }).select('_id').lean();
    const set = { lastSeenAt: new Date(), path, userAgent: String(userAgent || '').slice(0, 1000), device: parseDevice(userAgent) };
    if (!existing) set.location = resolveLocation(req, ip);
    await Visitor.findOneAndUpdate(
      { ip },
      {
        $setOnInsert: { firstSeenAt: new Date(), visitorHash, day },
        $set: set,
        $inc: { visitCount: 1 }
      },
      { upsert: true, new: true }
    );

    res.status(204).end();
  } catch (error) {
    // Never break the public site over analytics.
    res.status(204).end();
  }
};

const getVisitors = async (req, res) => {
  try {
    const { search, page = 1, limit = 20, from, to } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const query = { ip: { $exists: true, $ne: '' } };
    const seenRange = dateRange({ from, to });
    if (seenRange) query.lastSeenAt = seenRange;
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [{ ip: regex }, { 'location.city': regex }, { 'location.region': regex }, { 'location.country': regex }, { 'device.browser': regex }, { 'device.os': regex }, { path: regex }];
    }
    const [items, total] = await Promise.all([
      Visitor.find(query).sort({ lastSeenAt: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
      Visitor.countDocuments(query)
    ]);
    res.json({ items, total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 });
  } catch (error) { res.status(500).json({ message: error.message }); }
};

const getVisitor = async (req, res) => {
  try {
    const visitor = await Visitor.findOne({ _id: req.params.id, ip: { $exists: true, $ne: '' } }).lean();
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });
    res.json(visitor);
  } catch (error) { res.status(500).json({ message: error.message }); }
};

// Admin: unique visitors for the current month + comparison with previous month.
const getMonthlyStats = async (req, res) => {
  try {
    const now = new Date();
    const selectedRange = dateRange(req.query);
    const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const thisMonthPrefix = startOfThisMonth.toISOString().slice(0, 7); // YYYY-MM
    const lastMonthPrefix = startOfLastMonth.toISOString().slice(0, 7);

    const currentMatch = selectedRange
      ? { ip: { $exists: true, $ne: '' }, lastSeenAt: selectedRange }
      : { day: { $regex: `^${thisMonthPrefix}` } };
    const [thisMonthUnique, lastMonthUnique] = await Promise.all([
      Visitor.distinct(selectedRange ? 'ip' : 'visitorHash', currentMatch),
      selectedRange ? Promise.resolve([]) : Visitor.distinct('visitorHash', { day: { $regex: `^${lastMonthPrefix}` } })
    ]);

    const daily = await Visitor.aggregate([
      { $match: currentMatch },
      { $group: { _id: selectedRange ? { $dateToString: { format: '%Y-%m-%d', date: '$lastSeenAt' } } : '$day', uniqueVisitors: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    const current = thisMonthUnique.length;
    const previous = lastMonthUnique.length;
    const percentChange = previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);

    res.json({
      currentMonthUniqueVisitors: current,
      previousMonthUniqueVisitors: previous,
      percentChange,
      daily: daily.map((d) => ({ date: d._id, uniqueVisitors: d.uniqueVisitors })),
      rangeStart: (selectedRange?.$gte || startOfThisMonth).toISOString(),
      rangeEnd: (selectedRange?.$lte || startOfNextMonth).toISOString()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { trackVisit, getMonthlyStats, getVisitors, getVisitor };
