// backend/src/controllers/analyticsController.js
const crypto = require('crypto');
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

// Public: called once per session from the website to record an anonymous visit.
const trackVisit = async (req, res) => {
  try {
    const clientId = String(req.body?.clientId || '').trim().slice(0, 100) || null;
    const path = String(req.body?.path || '').trim().slice(0, 300);
    const ip = req.headers['x-forwarded-for'] || req.ip;
    const userAgent = req.get('user-agent');

    const visitorHash = hashVisitor({ ip, userAgent, clientId });
    const day = todayUTC();

    await Visitor.findOneAndUpdate(
      { visitorHash, day },
      {
        $setOnInsert: { firstSeenAt: new Date(), path },
        $set: { lastSeenAt: new Date() },
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

// Admin: unique visitors for the current month + comparison with previous month.
const getMonthlyStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    const thisMonthPrefix = startOfThisMonth.toISOString().slice(0, 7); // YYYY-MM
    const lastMonthPrefix = startOfLastMonth.toISOString().slice(0, 7);

    const [thisMonthUnique, lastMonthUnique] = await Promise.all([
      Visitor.distinct('visitorHash', { day: { $regex: `^${thisMonthPrefix}` } }),
      Visitor.distinct('visitorHash', { day: { $regex: `^${lastMonthPrefix}` } })
    ]);

    const daily = await Visitor.aggregate([
      { $match: { day: { $regex: `^${thisMonthPrefix}` } } },
      { $group: { _id: '$day', uniqueVisitors: { $sum: 1 } } },
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
      rangeStart: startOfThisMonth.toISOString(),
      rangeEnd: startOfNextMonth.toISOString()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { trackVisit, getMonthlyStats };
