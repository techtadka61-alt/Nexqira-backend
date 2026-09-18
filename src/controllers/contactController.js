const ContactMessage = require('../models/ContactMessage');
const VisitorSession = require('../models/VisitorSession');
const { sendMail } = require('../services/emailService');

function normalizeString(value) {
  return String(value ?? '').trim();
}

function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

const submitContact = async (req, res) => {
  try {
    const name = normalizeString(req.body?.name);
    const email = normalizeString(req.body?.email).toLowerCase();
    const phone = normalizeString(req.body?.phone);
    const subject = normalizeString(req.body?.subject);
    const message = normalizeString(req.body?.message);
    const source = normalizeString(req.body?.source) || 'web';
    const sessionId = normalizeString(req.body?.sessionId).slice(0, 100);

    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!message || message.length < 10) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const doc = await ContactMessage.create({
      name,
      email,
      phone,
      subject,
      message,
      source,
      sessionId,
      meta: {
        ip: normalizeString(req.headers['x-forwarded-for'] || req.ip),
        userAgent: normalizeString(req.get('user-agent')),
        referer: normalizeString(req.get('referer'))
      }
    });

    if (sessionId) {
      VisitorSession.updateOne(
        { sessionId, 'convertedLead.leadId': null },
        { $set: { 'convertedLead.leadType': 'contact', 'convertedLead.leadId': doc._id, 'convertedLead.convertedAt': new Date() } }
      ).catch(() => {});
    }

    let emailSent = false;
    const to = (process.env.CONTACT_TO || '').trim();
    if (to) {
      const safeSubject = subject || 'New contact request';
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
          <h2 style="margin:0 0 12px">New contact request</h2>
          <p style="margin:0 0 8px"><b>Name:</b> ${escapeHtml(name)}</p>
          <p style="margin:0 0 8px"><b>Email:</b> ${escapeHtml(email)}</p>
          ${phone ? `<p style="margin:0 0 8px"><b>Phone:</b> ${escapeHtml(phone)}</p>` : ''}
          ${subject ? `<p style="margin:0 0 8px"><b>Subject:</b> ${escapeHtml(subject)}</p>` : ''}
          <p style="margin:12px 0 8px"><b>Message:</b></p>
          <pre style="white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px;border:1px solid #e6e6e6">${escapeHtml(message)}</pre>
          <p style="color:#666;margin-top:12px">Source: ${escapeHtml(source)} · Id: ${doc._id}</p>
        </div>
      `;
      const text = `New contact request\n\nName: ${name}\nEmail: ${email}${phone ? `\nPhone: ${phone}` : ''}${subject ? `\nSubject: ${subject}` : ''}\n\nMessage:\n${message}\n\nSource: ${source}\nId: ${doc._id}`;

      try {
        await sendMail({
          to,
          subject: safeSubject,
          html,
          text
        });
        emailSent = true;
      } catch (err) {
        // Don't fail the contact request if email isn't configured.
        // The message is stored in DB for later review.
        emailSent = false;
      }
    }

    return res.status(201).json({ success: true, id: doc._id, emailSent });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: list contact submissions with search/date filter/pagination
const getContacts = async (req, res) => {
  try {
    const { search, from, to, page = 1, limit = 20, sort = 'newest' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const query = {};

    if (search) {
      const term = String(search).trim();
      if (term) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ name: regex }, { email: regex }];
      }
    }

    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const sortOrder = sort === 'oldest' ? 1 : -1;

    const [items, total] = await Promise.all([
      ContactMessage.find(query)
        .sort({ createdAt: sortOrder })
        .limit(limitNum)
        .skip((pageNum - 1) * limitNum),
      ContactMessage.countDocuments(query)
    ]);

    res.json({
      items,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum) || 1
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: get single contact submission
const getContact = async (req, res) => {
  try {
    const contact = await ContactMessage.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact submission not found' });
    }
    res.json(contact);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: delete contact submission
const deleteContact = async (req, res) => {
  try {
    const contact = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact submission not found' });
    }
    res.json({ success: true, deletedId: contact._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: stats for current week vs previous week (for dashboard card)
const getContactStats = async (req, res) => {
  try {
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfWeek = new Date(now.getTime() - now.getDay() * dayMs);
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfPrevWeek = new Date(startOfWeek.getTime() - 7 * dayMs);

    const [thisWeek, lastWeek, total] = await Promise.all([
      ContactMessage.countDocuments({ createdAt: { $gte: startOfWeek } }),
      ContactMessage.countDocuments({ createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek } }),
      ContactMessage.countDocuments()
    ]);

    const percentChange = lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
      : (thisWeek > 0 ? 100 : 0);

    const daily = await ContactMessage.aggregate([
      { $match: { createdAt: { $gte: startOfWeek } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      thisWeek,
      lastWeek,
      percentChange,
      total,
      daily: daily.map((d) => ({ date: d._id, count: d.count }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { submitContact, getContacts, getContact, deleteContact, getContactStats };
