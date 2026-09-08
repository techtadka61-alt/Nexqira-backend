const ContactMessage = require('../models/ContactMessage');
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
      meta: {
        ip: normalizeString(req.headers['x-forwarded-for'] || req.ip),
        userAgent: normalizeString(req.get('user-agent')),
        referer: normalizeString(req.get('referer'))
      }
    });

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

module.exports = { submitContact };
