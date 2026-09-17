const Post = require('../models/Post');
const ContactMessage = require('../models/ContactMessage');
const Visitor = require('../models/Visitor');

const getSummary = async (req, res) => {
  try {
    const now = new Date();
    const { from, to } = req.query;
    const customRange = {};
    if (from) customRange.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`);
    if (to) customRange.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    const hasCustomRange = Object.keys(customRange).length > 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfWeek = new Date(now.getTime() - now.getDay() * dayMs);
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfPrevWeek = new Date(startOfWeek.getTime() - 7 * dayMs);

    const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const thisMonthPrefix = startOfThisMonth.toISOString().slice(0, 7);
    const lastMonthPrefix = startOfLastMonth.toISOString().slice(0, 7);

    const [
      contactsThisWeek,
      contactsLastWeek,
      publishedBlogs,
      draftBlogs,
      totalBlogs,
      visitorsThisMonth,
      visitorsLastMonth
    ] = await Promise.all([
      ContactMessage.countDocuments(hasCustomRange ? { createdAt: customRange } : { createdAt: { $gte: startOfWeek } }),
      hasCustomRange ? Promise.resolve(0) : ContactMessage.countDocuments({ createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek } }),
      Post.countDocuments({ status: 'published' }),
      Post.countDocuments({ status: { $in: ['pending', 'approved', 'failed'] } }),
      Post.countDocuments(),
      Visitor.distinct(hasCustomRange ? 'ip' : 'visitorHash', hasCustomRange ? { ip: { $exists: true, $ne: '' }, lastSeenAt: customRange } : { day: { $regex: `^${thisMonthPrefix}` } }),
      hasCustomRange ? Promise.resolve([]) : Visitor.distinct('visitorHash', { day: { $regex: `^${lastMonthPrefix}` } })
    ]);

    const contactsPercentChange = contactsLastWeek > 0
      ? Math.round(((contactsThisWeek - contactsLastWeek) / contactsLastWeek) * 100)
      : (contactsThisWeek > 0 ? 100 : 0);

    const visitorsThisMonthCount = visitorsThisMonth.length;
    const visitorsLastMonthCount = visitorsLastMonth.length;
    const visitorsPercentChange = visitorsLastMonthCount > 0
      ? Math.round(((visitorsThisMonthCount - visitorsLastMonthCount) / visitorsLastMonthCount) * 100)
      : (visitorsThisMonthCount > 0 ? 100 : 0);

    res.json({
      contacts: {
        thisWeek: contactsThisWeek,
        lastWeek: contactsLastWeek,
        percentChange: contactsPercentChange
      },
      visitors: {
        thisMonth: visitorsThisMonthCount,
        lastMonth: visitorsLastMonthCount,
        percentChange: visitorsPercentChange
      },
      blogs: {
        published: publishedBlogs,
        draft: draftBlogs,
        total: totalBlogs
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getSummary };
