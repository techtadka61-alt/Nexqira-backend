// backend/src/controllers/analyticsController.js
const crypto = require('crypto');
const Visitor = require('../models/Visitor');
const VisitorSession = require('../models/VisitorSession');
const PageViewEvent = require('../models/PageViewEvent');
const { resolveLocation } = require('../services/geoService');

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
    if (!existing) set.location = await resolveLocation(req, ip);
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

// Public: called once per tab session on first page load. First-touch attribution
// (referrer/UTM/landing page) is set only on insert and never overwritten afterwards.
const trackSession = async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim().slice(0, 100);
    if (!sessionId) return res.status(204).end();

    const path = String(req.body?.path || '').trim().slice(0, 300);
    const referrer = String(req.body?.referrer || '').trim().slice(0, 500);
    const utmInput = req.body?.utm || {};
    const utm = {
      source: String(utmInput.source || '').trim().slice(0, 200),
      medium: String(utmInput.medium || '').trim().slice(0, 200),
      campaign: String(utmInput.campaign || '').trim().slice(0, 200),
      term: String(utmInput.term || '').trim().slice(0, 200),
      content: String(utmInput.content || '').trim().slice(0, 200)
    };

    const ip = normalizeIp(req.headers['x-forwarded-for'] || req.ip);
    const userAgent = req.get('user-agent');
    const visitorHash = hashVisitor({ ip, userAgent, clientId: sessionId });

    const priorSession = await VisitorSession.findOne({ visitorHash }).select('_id').lean();
    const isReturning = Boolean(priorSession);
    const location = await resolveLocation(req, ip);

    await VisitorSession.findOneAndUpdate(
      { sessionId },
      {
        $setOnInsert: {
          visitorHash,
          ip,
          userAgent: String(userAgent || '').slice(0, 1000),
          device: parseDevice(userAgent),
          location,
          referrer,
          utm,
          landingPage: path,
          firstActivityAt: new Date(),
          isReturning
        },
        $set: { lastActivityAt: new Date() }
      },
      { upsert: true, new: true }
    );

    res.status(204).end();
  } catch (error) {
    res.status(204).end();
  }
};

// Public: called on every route change to record a page view within a session.
const trackPageView = async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim().slice(0, 100);
    if (!sessionId) return res.status(204).end();

    const path = String(req.body?.path || '').trim().slice(0, 300);
    const referrer = String(req.body?.referrer || '').trim().slice(0, 500);

    await Promise.all([
      PageViewEvent.create({ sessionId, path, referrer }),
      VisitorSession.updateOne(
        { sessionId },
        { $set: { lastActivityAt: new Date() }, $inc: { pageViewCount: 1 } }
      )
    ]);

    res.status(204).end();
  } catch (error) {
    res.status(204).end();
  }
};

// Admin: dashboard-v2 overview - totals, unique visitors, new vs returning, device/browser.
const getOverview = async (req, res) => {
  try {
    const range = dateRange(req.query);
    const match = range ? { firstActivityAt: range } : {};

    const [totalSessions, uniqueVisitors, returningCount, devices, browsers, totalPageViews] = await Promise.all([
      VisitorSession.countDocuments(match),
      VisitorSession.distinct('visitorHash', match),
      VisitorSession.countDocuments({ ...match, isReturning: true }),
      VisitorSession.aggregate([
        { $match: match },
        { $group: { _id: '$device.type', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      VisitorSession.aggregate([
        { $match: match },
        { $group: { _id: '$device.browser', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      VisitorSession.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: '$pageViewCount' } } }])
    ]);

    res.json({
      totalSessions,
      uniqueVisitors: uniqueVisitors.length,
      returningVisitors: returningCount,
      newVisitors: totalSessions - returningCount,
      totalPageViews: totalPageViews[0]?.total || 0,
      devices: devices.map((d) => ({ type: d._id || 'Unknown', count: d.count })),
      browsers: browsers.map((b) => ({ browser: b._id || 'Unknown', count: b.count }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: visitors grouped by country/region/city for a date range.
const getGeoBreakdown = async (req, res) => {
  try {
    const range = dateRange(req.query);
    const match = range ? { firstActivityAt: range } : {};

    const rows = await VisitorSession.aggregate([
      { $match: match },
      {
        $group: {
          _id: { country: '$location.country', region: '$location.region', city: '$location.city' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 200 }
    ]);

    res.json({
      items: rows.map((r) => ({
        country: r._id.country || 'Unknown',
        region: r._id.region || '',
        city: r._id.city || '',
        count: r.count
      }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: visitors by date/hour bucket for a date range.
const getTimeseries = async (req, res) => {
  try {
    const range = dateRange(req.query);
    const match = range ? { firstActivityAt: range } : {};
    const granularity = req.query.granularity === 'hour' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';

    const rows = await VisitorSession.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: granularity, date: '$firstActivityAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({ items: rows.map((r) => ({ bucket: r._id, count: r.count })) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: most-visited pages and top traffic sources (referrer/UTM) for a date range.
const getPagesAndSources = async (req, res) => {
  try {
    const range = dateRange(req.query);
    const sessionMatch = range ? { firstActivityAt: range } : {};

    const sessionIds = range ? await VisitorSession.distinct('sessionId', sessionMatch) : null;
    const pageMatch = sessionIds ? { sessionId: { $in: sessionIds } } : {};

    const [topPages, topSources] = await Promise.all([
      PageViewEvent.aggregate([
        { $match: pageMatch },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),
      VisitorSession.aggregate([
        { $match: sessionMatch },
        {
          $group: {
            _id: { $cond: [{ $ne: ['$utm.source', ''] }, '$utm.source', { $ifNull: ['$referrer', 'direct'] }] },
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ])
    ]);

    res.json({
      topPages: topPages.map((p) => ({ path: p._id || '(unknown)', count: p.count })),
      topSources: topSources.map((s) => ({ source: s._id || 'direct', count: s.count }))
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Admin: unique visitors -> sessions -> leads funnel + conversion rate for a date range.
const getFunnel = async (req, res) => {
  try {
    // Lazy require to avoid a require cycle at module load time.
    const ContactMessage = require('../models/ContactMessage');
    const ChatLead = require('../models/ChatLead');

    const range = dateRange(req.query);
    const sessionMatch = range ? { firstActivityAt: range } : {};
    const leadMatch = range ? { createdAt: range } : {};

    const [uniqueVisitors, totalSessions, convertedSessions, contactLeads, chatLeads] = await Promise.all([
      VisitorSession.distinct('visitorHash', sessionMatch),
      VisitorSession.countDocuments(sessionMatch),
      VisitorSession.countDocuments({ ...sessionMatch, 'convertedLead.leadId': { $ne: null } }),
      ContactMessage.countDocuments(leadMatch),
      ChatLead.countDocuments(leadMatch)
    ]);

    const qualifiedLeads = contactLeads + chatLeads;
    const visitorCount = uniqueVisitors.length;
    const conversionRate = visitorCount > 0 ? Number(((qualifiedLeads / visitorCount) * 100).toFixed(2)) : 0;

    res.json({
      uniqueVisitors: visitorCount,
      totalSessions,
      convertedSessions,
      qualifiedLeads,
      contactLeads,
      chatLeads,
      conversionRate
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  trackVisit,
  trackSession,
  trackPageView,
  getMonthlyStats,
  getVisitors,
  getVisitor,
  getOverview,
  getGeoBreakdown,
  getTimeseries,
  getPagesAndSources,
  getFunnel
};
