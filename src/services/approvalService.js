const jwt = require('jsonwebtoken');
const { sendMail } = require('./emailService');

const getApprovalRecipient = (overrideTo) => {
  return String(overrideTo || process.env.ADMIN_APPROVAL_EMAIL_TO || process.env.ADMIN_EMAIL || '').trim();
};

const getPublicApiBaseUrl = () => {
  const explicit = String(process.env.PUBLIC_API_BASE_URL || process.env.API_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const port = String(process.env.PORT || '5000').trim();
  return `http://localhost:${port}/api/v1`;
};

const buildReviewUrl = (postId) => {
  const reviewBase = String(process.env.ADMIN_REVIEW_URL_BASE || '').trim().replace(/\/$/, '');
  if (!reviewBase) return null;
  return `${reviewBase}/admin/blogs/${postId}`;
};

const buildApprovalUrls = (postId) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');

  const approveToken = jwt.sign({ postId, action: 'approve' }, secret, { expiresIn: '1d' });
  const rejectToken = jwt.sign({ postId, action: 'reject' }, secret, { expiresIn: '1d' });
  const base = getPublicApiBaseUrl();

  return {
    approveUrl: `${base}/admin/approval/${approveToken}`,
    rejectUrl: `${base}/admin/approval/${rejectToken}`,
  };
};

const sendApprovalEmailForPost = async (post, overrideTo) => {
  const to = getApprovalRecipient(overrideTo);
  if (!to) {
    throw new Error('Missing recipient email (set ADMIN_APPROVAL_EMAIL_TO or ADMIN_EMAIL)');
  }

  const title = post.blogTitle || post.title;
  const { approveUrl, rejectUrl } = buildApprovalUrls(post._id);
  const reviewUrl = buildReviewUrl(post._id);

  await sendMail({
    to,
    subject: `Approval needed: ${title}`,
    text: `Approve: ${approveUrl}\nReject: ${rejectUrl}${reviewUrl ? `\nReview: ${reviewUrl}` : ''}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 8px;">Approval needed</h2>
        <div style="color: #444; margin-bottom: 12px;"><strong>${escapeHtml(title)}</strong></div>
        <div style="color: #666; margin-bottom: 16px;">${escapeHtml(post.excerpt || '')}</div>
        <div style="display: flex; gap: 10px; margin-top: 16px;">
          <a href="${approveUrl}" style="background: #16a34a; color: white; padding: 10px 14px; text-decoration: none; border-radius: 6px;">Approve</a>
          <a href="${rejectUrl}" style="background: #dc2626; color: white; padding: 10px 14px; text-decoration: none; border-radius: 6px;">Reject</a>
          ${reviewUrl ? `<a href="${reviewUrl}" style="background: #111827; color: white; padding: 10px 14px; text-decoration: none; border-radius: 6px;">Review</a>` : ''}
        </div>
        <p style="margin-top: 16px; color: #888; font-size: 12px;">Links expire in 24 hours.</p>
      </div>
    `
  });

  return { to, approveUrl, rejectUrl, reviewUrl };
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  sendApprovalEmailForPost,
};
