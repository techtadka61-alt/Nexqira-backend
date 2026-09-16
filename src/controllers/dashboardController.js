const Post = require('../models/Post');
const ContactMessage = require('../models/ContactMessage');
const Visitor = require('../models/Visitor');

const getSummary = async (req, res) => {
  try {
    const now = new Date();
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
      ContactMessage.countDocuments({ createdAt: { $gte: startOfWeek } }),
      ContactMessage.countDocuments({ createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek } }),
      Post.countDocuments({ status: 'published' }),
      Post.countDocuments({ status: { $in: ['pending', 'approved', 'failed'] } }),
      Post.countDocuments(),
      Visitor.distinct('visitorHash', { day: { $regex: `^${thisMonthPrefix}` } }),
      Visitor.distinct('visitorHash', { day: { $regex: `^${lastMonthPrefix}` } })
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
