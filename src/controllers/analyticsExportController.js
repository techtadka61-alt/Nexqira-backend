// backend/src/controllers/analyticsExportController.js
const ExcelJS = require('exceljs');
const VisitorSession = require('../models/VisitorSession');
const PageViewEvent = require('../models/PageViewEvent');

function dateRange(query) {
  const range = {};
  if (query.from) range.$gte = new Date(`${String(query.from).slice(0, 10)}T00:00:00.000Z`);
  if (query.to) range.$lte = new Date(`${String(query.to).slice(0, 10)}T23:59:59.999Z`);
  return Object.keys(range).length ? range : null;
}

async function fetchRows(type, range) {
  if (type === 'pageviews') {
    const sessionMatch = range ? { firstActivityAt: range } : {};
    const sessionIds = range ? await VisitorSession.distinct('sessionId', sessionMatch) : null;
    const match = sessionIds ? { sessionId: { $in: sessionIds } } : {};
    const rows = await PageViewEvent.find(match).sort({ timestamp: -1 }).limit(10000).lean();
    return {
      columns: ['Session ID', 'Path', 'Referrer', 'Timestamp'],
      rows: rows.map((r) => [r.sessionId, r.path, r.referrer, r.timestamp.toISOString()])
    };
  }

  // Default: sessions export.
  const match = range ? { firstActivityAt: range } : {};
  const rows = await VisitorSession.find(match).sort({ firstActivityAt: -1 }).limit(10000).lean();
  return {
    columns: [
      'Session ID', 'First Seen', 'Last Seen', 'City', 'Region', 'Country',
      'Device', 'OS', 'Browser', 'Referrer', 'UTM Source', 'UTM Medium', 'UTM Campaign',
      'Landing Page', 'Page Views', 'Returning', 'Converted'
    ],
    rows: rows.map((r) => [
      r.sessionId,
      r.firstActivityAt?.toISOString() || '',
      r.lastActivityAt?.toISOString() || '',
      r.location?.city || '',
      r.location?.region || '',
      r.location?.country || '',
      r.device?.type || '',
      r.device?.os || '',
      r.device?.browser || '',
      r.referrer || '',
      r.utm?.source || '',
      r.utm?.medium || '',
      r.utm?.campaign || '',
      r.landingPage || '',
      r.pageViewCount || 0,
      r.isReturning ? 'Yes' : 'No',
      r.convertedLead?.leadId ? 'Yes' : 'No'
    ])
  };
}

// Admin: export visitor sessions or page views as CSV/XLSX for a date range.
const exportAnalytics = async (req, res) => {
  try {
    const type = req.query.type === 'pageviews' ? 'pageviews' : 'sessions';
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const range = dateRange(req.query);

    const { columns, rows } = await fetchRows(type, range);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Analytics');
    sheet.addRow(columns);
    rows.forEach((row) => sheet.addRow(row));

    const filename = `nexqira-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;

    if (format === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const buffer = await workbook.csv.writeBuffer();
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { exportAnalytics };
