const jwt = require('jsonwebtoken');
const Post = require('../models/Post');
const Log = require('../models/Log');
const linkedinService = require('../services/linkedinService');
const { sendApprovalEmailForPost } = require('../services/approvalService');

const coercePrimaryCategory = (category, metadata) => {
  const cat = String(category || '').trim();
  if (cat) return cat;
  const legacy = metadata?.categories?.[0];
  return legacy || 'Technology';
};

const publishToBlog = async (post) => {
  post.status = 'published';
  post.publishedAt = post.publishedAt || new Date();
  post.metadata = post.metadata || {};
  post.metadata.blogPost = {
    ...(post.metadata.blogPost || {}),
    publishedAt: new Date(),
    url: `https://nexqira.online/blog/${post.slug}`,
    status: 'published'
  };
  post.metadata.platformStatus = post.metadata.platformStatus || {};
  post.metadata.platformStatus.blog = {
    status: 'published',
    publishedAt: new Date(),
    url: post.metadata.blogPost.url
  };
};

const publishToLinkedIn = async (post) => {
  const title = post.linkedInTitle || post.blogTitle || post.title;
  const body = String(post.linkedInContent || '').trim();
  const content = body ? `${title}\n\n${body}` : `${title}`;

  const result = await linkedinService.postToLinkedIn(content, post.featuredImage || null, []);

  post.metadata = post.metadata || {};
  post.metadata.linkedInPost = {
    ...(post.metadata.linkedInPost || {}),
    postedAt: new Date(),
    postId: result.postId,
    postUrl: result.postUrl,
    status: 'published'
  };
  post.metadata.platformStatus = post.metadata.platformStatus || {};
  post.metadata.platformStatus.linkedin = {
    status: 'published',
    postedAt: new Date(),
    postId: result.postId,
    postUrl: result.postUrl
  };
  return result;
};

const approveAndPublish = async (post) => {
  post.status = 'approved';
  post.approvedAt = new Date();

  post.category = coercePrimaryCategory(post.category, post.metadata);
  post.metadata = post.metadata || {};
  post.metadata.categories = [post.category, ...(post.metadata.categories || []).filter((c) => c && c !== post.category)];

  const results = { blog: null, linkedin: null };
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];

  if (platforms.includes('blog')) {
    await publishToBlog(post);
    results.blog = { success: true };
  }

  if (platforms.includes('linkedin')) {
    try {
      const r = await publishToLinkedIn(post);
      results.linkedin = { success: true, ...r };
    } catch (err) {
      post.metadata.platformStatus = post.metadata.platformStatus || {};
      post.metadata.platformStatus.linkedin = {
        status: 'failed',
        error: err.response?.data || err.message || 'LinkedIn publish failed'
      };
      results.linkedin = { success: false, error: err.message };
    }
  }

  return results;
};

const rejectAndDeletePost = async (post, reason) => {
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];

  await Log.create({
    level: 'warn',
    message: `Post rejected: ${post.blogTitle || post.title}`,
    category: 'system',
    postId: post._id,
    metadata: { reason: reason || 'Rejected via email link', platforms, action: 'reject_delete' }
  });

  await Post.deleteOne({ _id: post._id });
};

// POST /api/admin/posts/:id/send-approval-email
const sendApprovalEmail = async (req, res) => {
  try {
    const to = String(req.body?.to || process.env.ADMIN_APPROVAL_EMAIL_TO || '').trim();
    if (!to) return res.status(400).json({ message: 'Missing recipient email (set ADMIN_APPROVAL_EMAIL_TO or send {to})' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    await sendApprovalEmailForPost(post, to);

    await Log.create({
      level: 'info',
      message: `Approval email sent for post: ${post.blogTitle || post.title}`,
      category: 'system',
      userId: req.user?._id,
      postId: post._id,
      metadata: { to }
    });

    res.json({ message: 'Approval email sent', to });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/admin/approval/:token
const handleApprovalLink = async (req, res) => {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).send('JWT_SECRET not configured');

    const decoded = jwt.verify(req.params.token, secret);
    const post = await Post.findById(decoded.postId);
    if (!post) return res.status(404).send('Post not found');

    if (decoded.action === 'approve') {
      const results = await approveAndPublish(post);
      await post.save();

      await Log.create({
        level: 'info',
        message: `Post approved via email link: ${post.blogTitle || post.title}`,
        category: 'system',
        postId: post._id,
        metadata: { results }
      });

      return res.status(200).send(renderHtml('Approved', 'Post approved successfully.'));
    }

    if (decoded.action === 'reject') {
      await rejectAndDeletePost(post, 'Rejected via email link');

      return res.status(200).send(renderHtml('Rejected', 'Post rejected successfully.'));
    }

    return res.status(400).send('Invalid action');
  } catch (error) {
    return res.status(400).send(`Invalid or expired link: ${escapeHtml(error.message)}`);
  }
};

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderHtml(title, message) {
  return `
    <html>
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(title)}</title></head>
      <body style="font-family: Arial, sans-serif; background: #f9fafb; padding: 24px;">
        <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px;">
          <h2 style="margin: 0 0 10px;">${escapeHtml(title)}</h2>
          <div style="color: #374151;">${escapeHtml(message)}</div>
        </div>
      </body>
    </html>
  `;
}

module.exports = {
  sendApprovalEmail,
  handleApprovalLink
};
