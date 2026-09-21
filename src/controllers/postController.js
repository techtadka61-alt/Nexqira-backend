const Post = require('../models/Post');

const publicSiteUrl = String(process.env.PUBLIC_SITE_URL || 'https://nexqira.online').trim().replace(/\/$/, '');
const Log = require('../models/Log');
const linkedinService = require('../services/linkedinService');
const { sanitizePostContent } = require('../utils/sanitizeHtml');

const KNOWN_PLATFORMS = ['blog', 'linkedin'];

const ensurePlatformStatus = (post) => {
  post.metadata = post.metadata || {};
  post.metadata.platformStatus = post.metadata.platformStatus || {};

  const selected = new Set(Array.isArray(post.platforms) ? post.platforms : []);
  for (const p of KNOWN_PLATFORMS) {
    const existing = post.metadata.platformStatus?.[p] || {};
    if (existing && typeof existing === 'object' && existing.status) continue;

    // Best-effort infer from legacy overall status
    let inferred = 'not_published';
    if (selected.has(p)) {
      const overall = String(post.status || '').toLowerCase();
      if (overall === 'published') inferred = 'published';
      else if (overall === 'approved') inferred = 'approved';
      else if (overall === 'failed') inferred = 'failed';
      else inferred = 'pending';
    }

    post.metadata.platformStatus[p] = { ...(existing || {}), status: inferred };
  }

  if (typeof post.markModified === 'function') {
    post.markModified('metadata');
  }
};

const recomputeOverallStatus = (post) => {
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  if (platforms.length === 0) return;

  ensurePlatformStatus(post);
  const platformStatuses = post.metadata?.platformStatus || {};
  
  const statuses = platforms
    .map((p) => String(platformStatuses[p]?.status || '').toLowerCase())
    .filter(Boolean);

  // If ALL platforms failed, then overall is failed
  if (statuses.length > 0 && statuses.every((s) => s === 'failed')) {
    post.status = 'failed';
    return;
  }

  // If ANY platform is published, we can consider it partially published or published
  // For the website to show it, we prefer 'published' if the blog part is done.
  if (platformStatuses.blog?.status === 'published') {
    post.status = 'published';
    return;
  }

  // If anything is approved but not yet published
  if (statuses.some((s) => s === 'approved')) {
    post.status = 'approved';
    return;
  }

  // Fallback to failed if there are failures but no successes
  if (statuses.some((s) => s === 'failed')) {
    post.status = 'failed';
    return;
  }

  post.status = 'pending';
};

const normalizePlatforms = (platforms) => {
  if (!platforms) return undefined;
  if (Array.isArray(platforms)) return platforms;
  if (typeof platforms === 'string') {
    return platforms
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return undefined;
};

const coercePrimaryCategory = (category, metadata) => {
  const cat = String(category || '').trim();
  if (cat) return cat;
  const legacy = metadata?.categories?.[0];
  return legacy || 'Technology';
};

const publishToBlog = async (post) => {
  // In current implementation, publishing means marking status and storing a public URL
  post.publishedAt = post.publishedAt || new Date();
  post.metadata = post.metadata || {};
  post.metadata.platformStatus = post.metadata.platformStatus || {};
  post.metadata.blogPost = {
    ...(post.metadata.blogPost || {}),
    publishedAt: new Date(),
    url: `${publicSiteUrl}/blog/${post.slug}`,
    status: 'published'
  };
  post.metadata.platformStatus.blog = {
    ...(post.metadata.platformStatus.blog || {}),
    status: 'published',
    publishedAt: new Date(),
    url: post.metadata.blogPost.url
  };

  if (typeof post.markModified === 'function') {
    post.markModified('metadata');
  }
};

const publishToLinkedIn = async (post, { updateExisting = false } = {}) => {
  const title = post.linkedInTitle || post.blogTitle || post.title;
  const body = String(post.linkedInContent || '').trim();
  const content = body
    ? `${title}\n\n${body}`
    : `${title}`;

  if (updateExisting) {
    const existingPostId =
      post?.metadata?.platformStatus?.linkedin?.postId ||
      post?.metadata?.linkedInPost?.postId;

    if (!existingPostId) {
      // Hard-stop to prevent accidental duplicates.
      throw new Error('Cannot update LinkedIn post: existing postId is not stored for this post');
    }

    // To avoid duplicates, delete the previous post first. If deletion fails, abort.
    await linkedinService.deletePost(existingPostId);
    post.metadata = post.metadata || {};
    post.metadata.linkedInPost = post.metadata.linkedInPost || {};
    post.metadata.linkedInPost.previousPostIds = Array.isArray(post.metadata.linkedInPost.previousPostIds)
      ? post.metadata.linkedInPost.previousPostIds
      : [];
    post.metadata.linkedInPost.previousPostIds.push(existingPostId);
    if (typeof post.markModified === 'function') {
      post.markModified('metadata');
    }
  }

  const result = await linkedinService.postToLinkedIn(content, post.featuredImage || null, []);

  post.metadata = post.metadata || {};
  post.metadata.platformStatus = post.metadata.platformStatus || {};
  post.metadata.linkedInPost = {
    ...(post.metadata.linkedInPost || {}),
    postedAt: new Date(),
    postId: result.postId,
    postUrl: result.postUrl,
    status: 'published'
  };
  post.metadata.platformStatus.linkedin = {
    ...(post.metadata.platformStatus.linkedin || {}),
    status: 'published',
    postedAt: new Date(),
    postId: result.postId,
    postUrl: result.postUrl
  };

  if (typeof post.markModified === 'function') {
    post.markModified('metadata');
  }
  return result;
};

// Get all posts
const getPosts = async (req, res) => {
  try {
    const { status, platform, search, from, to, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const query = {};
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      query.status = list.length > 1 ? { $in: list } : list[0];
    }
    if (search && String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [{ title: regex }, { blogTitle: regex }, { category: regex }, { slug: regex }];
    }
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(`${String(from).slice(0, 10)}T00:00:00.000Z`);
      if (to) query.createdAt.$lte = new Date(`${String(to).slice(0, 10)}T23:59:59.999Z`);
    }

    // If platform filter is provided, prefer per-platform status (metadata.platformStatus.<platform>.status)
    if (platform) {
      query.platforms = { $in: [platform] };

      if (status) {
        const statusList = String(status)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

        const platformPath = `metadata.platformStatus.${platform}.status`;
        const platformCond = statusList.length > 1 ? { $in: statusList } : statusList[0];
        // Backward compat: only fall back to legacy overall status when platformStatus is missing.
        query.$or = [
          { [platformPath]: platformCond },
          { [platformPath]: { $exists: false }, status: platformCond },
        ];

        // Remove legacy status filter at root to avoid over-filtering with $or
        delete query.status;
      }
    }

    const posts = await Post.find(query)
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    const total = await Post.countDocuments(query);

    res.json({
      posts,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get single post
const getPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    res.json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Approve post
const approvePost = async (req, res) => {
  try {
    const { publish = true } = req.body || {};
    const publishPlatforms = normalizePlatforms(req.body?.publishPlatforms || req.body?.platforms);
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    ensurePlatformStatus(post);
    post.approvedAt = new Date();

    // Keep category and legacy metadata.categories in sync
    post.category = coercePrimaryCategory(post.category, post.metadata);
    post.metadata = post.metadata || {};
    post.metadata.categories = [post.category, ...(post.metadata.categories || []).filter((c) => c && c !== post.category)];
    post.markModified('metadata');

    const currentPlatforms = Array.isArray(post.platforms) ? post.platforms : [];
    const requestedPlatforms = Array.isArray(publishPlatforms) ? publishPlatforms : null;
    const platformsToApprove = requestedPlatforms
      ? requestedPlatforms.filter((p) => currentPlatforms.includes(p))
      : currentPlatforms;

    for (const p of platformsToApprove) {
      post.metadata.platformStatus[p] = {
        ...(post.metadata.platformStatus[p] || {}),
        status: 'approved',
        approvedAt: new Date(),
      };
    }
    post.markModified('metadata');

    const results = { blog: null, linkedin: null };
    if (publish) {
      if (platformsToApprove.includes('blog')) {
        await publishToBlog(post);
        results.blog = { success: true };
      }
      if (platformsToApprove.includes('linkedin')) {
        try {
          const r = await publishToLinkedIn(post);
          results.linkedin = { success: true, ...r };
        } catch (err) {
          post.metadata = post.metadata || {};
          post.metadata.platformStatus = post.metadata.platformStatus || {};
          post.metadata.platformStatus.linkedin = {
            ...(post.metadata.platformStatus.linkedin || {}),
            status: 'failed',
            error: err.response?.data || err.message || 'LinkedIn publish failed'
          };
          post.markModified('metadata');
          results.linkedin = { success: false, error: err.message };
        }
      }
    }

    recomputeOverallStatus(post);

    await post.save();

    await Log.create({
      level: 'info',
      message: `Post approved: ${post.title}`,
      category: 'system',
      userId: req.user._id,
      postId: post._id,
    });

    res.json({ message: 'Post approved', post, publishResults: results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reject post
const rejectPost = async (req, res) => {
  try {
    const { reason } = req.body || {};
    const platform = String(req.body?.platform || req.query?.platform || '').trim().toLowerCase();
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const platforms = Array.isArray(post.platforms) ? post.platforms : [];

    // Per-platform reject: allow rejecting the target platform even if another platform is approved.
    if (platform) {
      if (!platforms.includes(platform)) {
        return res.status(400).json({ message: `Post is not enabled for platform: ${platform}` });
      }

      ensurePlatformStatus(post);
      const current = String(post.metadata?.platformStatus?.[platform]?.status || 'pending').toLowerCase();
      if (current === 'approved' || current === 'published') {
        return res.status(400).json({ message: 'Approved posts cannot be rejected' });
      }

      await Log.create({
        level: 'warn',
        message: `Post rejected (platform=${platform}): ${post.title}`,
        category: 'system',
        userId: req.user._id,
        postId: post._id,
        metadata: { reason, platforms: [platform], action: 'reject_delete' },
      });

      // If this is the only platform, delete the entire post.
      if (platforms.length <= 1) {
        await Post.deleteOne({ _id: post._id });
        return res.json({ message: 'Post rejected and deleted', deletedId: post._id, platform });
      }

      // Otherwise, remove only this platform.
      post.platforms = platforms.filter((p) => p !== platform);
      post.metadata = post.metadata || {};
      post.metadata.platformStatus = post.metadata.platformStatus || {};
      post.metadata.platformStatus[platform] = {
        ...(post.metadata.platformStatus[platform] || {}),
        status: 'rejected',
        rejectedAt: new Date(),
      };
      post.markModified('metadata');

      recomputeOverallStatus(post);
      await post.save();

      return res.json({ message: 'Platform rejected', post, platform });
    }

    // Legacy: whole-post reject
    if (post.status === 'approved' || post.status === 'published') {
      return res.status(400).json({ message: 'Approved posts cannot be rejected' });
    }

    await Log.create({
      level: 'warn',
      message: `Post rejected: ${post.title}`,
      category: 'system',
      userId: req.user._id,
      postId: post._id,
      metadata: { reason, platforms, action: 'reject_delete' },
    });

    await Post.deleteOne({ _id: post._id });

    res.json({ message: 'Post rejected and deleted', deletedId: post._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete post (admin) - supports per-platform delete
const deletePost = async (req, res) => {
  try {
    const platform = String(req.query?.platform || req.body?.platform || '').trim().toLowerCase();
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const platforms = Array.isArray(post.platforms) ? post.platforms : [];

    const deleteLinkedInIfPresent = async () => {
      const postId = post?.metadata?.platformStatus?.linkedin?.postId || post?.metadata?.linkedInPost?.postId;
      if (postId) {
        await linkedinService.deletePost(postId);
      }
    };

    if (platform) {
      if (!platforms.includes(platform)) {
        return res.status(400).json({ message: `Post is not enabled for platform: ${platform}` });
      }

      // If LinkedIn is being deleted and it was published, delete from LinkedIn first.
      if (platform === 'linkedin') {
        const st = String(post?.metadata?.platformStatus?.linkedin?.status || '').toLowerCase();
        if (st === 'published') {
          await deleteLinkedInIfPresent();
        }
      }

      await Log.create({
        level: 'warn',
        message: `Post deleted (platform=${platform}): ${post.title}`,
        category: 'system',
        userId: req.user?._id,
        postId: post._id,
        metadata: { platform, action: 'delete' },
      });

      // If this is the only platform, delete the entire post.
      if (platforms.length <= 1) {
        await Post.deleteOne({ _id: post._id });
        return res.json({ message: 'Post deleted', deletedId: post._id, platform });
      }

      // Otherwise, remove just this platform.
      post.platforms = platforms.filter((p) => p !== platform);
      post.metadata = post.metadata || {};
      post.metadata.platformStatus = post.metadata.platformStatus || {};
      post.metadata.platformStatus[platform] = {
        ...(post.metadata.platformStatus[platform] || {}),
        status: 'deleted',
        deletedAt: new Date(),
      };
      if (typeof post.markModified === 'function') {
        post.markModified('metadata');
      }

      recomputeOverallStatus(post);
      await post.save();
      return res.json({ message: 'Platform deleted', post, platform });
    }

    // Whole post delete
    if (platforms.includes('linkedin')) {
      const st = String(post?.metadata?.platformStatus?.linkedin?.status || '').toLowerCase();
      if (st === 'published') {
        await deleteLinkedInIfPresent();
      }
    }

    await Log.create({
      level: 'warn',
      message: `Post deleted: ${post.title}`,
      category: 'system',
      userId: req.user?._id,
      postId: post._id,
      metadata: { platforms, action: 'delete' },
    });

    await Post.deleteOne({ _id: post._id });
    res.json({ message: 'Post deleted', deletedId: post._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update post (admin editing)
const updatePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const {
      title,
      blogTitle,
      linkedInTitle,
      content,
      excerpt,
      featuredImage,
      additionalImages,
      linkedInContent,
      platforms,
      category
    } = req.body || {};

    if (typeof title === 'string') post.title = title;
    if (typeof blogTitle === 'string') post.blogTitle = blogTitle;
    if (typeof linkedInTitle === 'string') post.linkedInTitle = linkedInTitle;
    if (typeof content === 'string') post.content = sanitizePostContent(content);
    if (typeof excerpt === 'string') post.excerpt = excerpt;
    if (typeof featuredImage === 'string') post.featuredImage = featuredImage;
    if (typeof linkedInContent === 'string') post.linkedInContent = linkedInContent;

    const p = normalizePlatforms(platforms);
    if (p) post.platforms = p;

    if (Array.isArray(additionalImages)) {
      post.additionalImages = additionalImages.filter((x) => typeof x === 'string');
    }

    if (typeof category === 'string') post.category = category;
    post.category = coercePrimaryCategory(post.category, post.metadata);
    post.metadata = post.metadata || {};
    post.metadata.categories = [post.category, ...(post.metadata.categories || []).filter((c) => c && c !== post.category)];
    post.markModified('metadata');

    await post.save();

    await Log.create({
      level: 'info',
      message: `Post updated: ${post.blogTitle || post.title}`,
      category: 'system',
      userId: req.user?._id,
      postId: post._id,
    });

    res.json({ message: 'Post updated', post });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Publish a post to selected platforms (can be called after editing)
const publishPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const requested = normalizePlatforms(req.body?.platforms) || post.platforms || [];
    const updateExisting = Boolean(req.body?.updateExisting);
    const results = { blog: null, linkedin: null };

    ensurePlatformStatus(post);

    if (requested.includes('blog')) {
      await publishToBlog(post);
      results.blog = { success: true };
    }

    if (requested.includes('linkedin')) {
      try {
        const r = await publishToLinkedIn(post, { updateExisting });
        results.linkedin = { success: true, ...r };
      } catch (err) {
        post.metadata = post.metadata || {};
        post.metadata.platformStatus = post.metadata.platformStatus || {};
        post.metadata.platformStatus.linkedin = {
          ...(post.metadata.platformStatus.linkedin || {}),
          status: 'failed',
          error: err.response?.data || err.message || 'LinkedIn publish failed'
        };
        post.markModified('metadata');
        results.linkedin = { success: false, error: err.message };
      }
    }

    recomputeOverallStatus(post);

    await post.save();

    await Log.create({
      level: 'info',
      message: `Post published: ${post.blogTitle || post.title}`,
      category: 'system',
      userId: req.user?._id,
      postId: post._id,
      metadata: { platforms: requested, results },
    });

    res.json({ message: 'Publish attempted', post, results });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Unpublish a post from the blog platform (revert to draft/pending)
const unpublishPost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    ensurePlatformStatus(post);
    post.metadata = post.metadata || {};
    post.metadata.platformStatus = post.metadata.platformStatus || {};
    post.metadata.platformStatus.blog = {
      ...(post.metadata.platformStatus.blog || {}),
      status: 'pending',
    };
    if (post.metadata.blogPost) {
      post.metadata.blogPost.status = 'unpublished';
    }
    post.markModified('metadata');

    recomputeOverallStatus(post);
    await post.save();

    await Log.create({
      level: 'info',
      message: `Post unpublished: ${post.blogTitle || post.title}`,
      category: 'system',
      userId: req.user?._id,
      postId: post._id,
    });

    res.json({ message: 'Post unpublished', post });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create post (from generated news)
const createPost = async (req, res) => {
  try {
    const body = req.body || {};

    const title = String(body.title || body.blogTitle || 'Untitled').trim() || 'Untitled';
    const blogTitle = typeof body.blogTitle === 'string' ? body.blogTitle : title;
    const linkedInTitle = typeof body.linkedInTitle === 'string' ? body.linkedInTitle : title;

    const slug = String(body.slug || '').trim() || (
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') + '-' + Date.now()
    );

    const category = coercePrimaryCategory(body.category, body.metadata);

    const post = await Post.create({
      ...body,
      title,
      blogTitle,
      linkedInTitle,
      slug,
      category,
      content: typeof body.content === 'string' ? sanitizePostContent(body.content) : body.content,
      metadata: {
        ...(body.metadata || {}),
        categories: [category, ...((body.metadata?.categories || []).filter((c) => c && c !== category))]
      }
    });

    // Initialize per-platform status for new posts
    ensurePlatformStatus(post);
    const selected = new Set(Array.isArray(post.platforms) ? post.platforms : []);
    for (const p of KNOWN_PLATFORMS) {
      if (selected.has(p)) {
        post.metadata.platformStatus[p] = { ...(post.metadata.platformStatus[p] || {}), status: 'pending' };
      } else {
        post.metadata.platformStatus[p] = { ...(post.metadata.platformStatus[p] || {}), status: 'not_published' };
      }
    }

    // If the admin published immediately (status sent as 'published'), mark the
    // blog platform as published now instead of leaving it 'pending' — otherwise
    // recomputeOverallStatus below would silently downgrade the post back to
    // 'pending' and it would never show up on the public website.
    if (body.status === 'published' && selected.has('blog')) {
      await publishToBlog(post);
    }

    recomputeOverallStatus(post);
    post.markModified('metadata');
    await post.save();

    res.status(201).json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get stats
const getStats = async (req, res) => {
  try {
    const total = await Post.countDocuments();

    // Prefer per-platform status; fall back to legacy overall status if platformStatus is missing
    const linkedinApproved = await Post.countDocuments({
      platforms: { $in: ['linkedin'] },
      $or: [
        { 'metadata.platformStatus.linkedin.status': { $in: ['approved', 'published'] } },
        { 'metadata.platformStatus.linkedin.status': { $exists: false }, status: { $in: ['approved', 'published'] } },
      ]
    });

    const websiteApproved = await Post.countDocuments({
      platforms: { $in: ['blog'] },
      $or: [
        { 'metadata.platformStatus.blog.status': { $in: ['approved', 'published'] } },
        { 'metadata.platformStatus.blog.status': { $exists: false }, status: { $in: ['approved', 'published'] } },
      ]
    });

    const pendingLinkedin = await Post.countDocuments({
      platforms: { $in: ['linkedin'] },
      $or: [
        { 'metadata.platformStatus.linkedin.status': 'pending' },
        { 'metadata.platformStatus.linkedin.status': { $exists: false }, status: 'pending' },
      ]
    });

    const pendingBlog = await Post.countDocuments({
      platforms: { $in: ['blog'] },
      $or: [
        { 'metadata.platformStatus.blog.status': 'pending' },
        { 'metadata.platformStatus.blog.status': { $exists: false }, status: 'pending' },
      ]
    });

    // Rejected posts are deleted; count rejections via logs (logs expire in 30 days by schema).
    const rejectedTotal = await Log.countDocuments({
      category: 'system',
      'metadata.action': 'reject_delete'
    });

    const rejectedLinkedin = await Log.countDocuments({
      category: 'system',
      'metadata.action': 'reject_delete',
      'metadata.platforms': { $in: ['linkedin'] }
    });

    const rejectedBlog = await Log.countDocuments({
      category: 'system',
      'metadata.action': 'reject_delete',
      'metadata.platforms': { $in: ['blog'] }
    });

    // Optional totals available in DB (reach is not available without LinkedIn analytics API)
    const blogViewsAgg = await Post.aggregate([
      { $match: { platforms: { $in: ['blog'] } } },
      { $group: { _id: null, totalViews: { $sum: '$views' } } }
    ]);
    const totalBlogViews = blogViewsAgg?.[0]?.totalViews || 0;

    const linkedinEngagementAgg = await Post.aggregate([
      { $match: { platforms: { $in: ['linkedin'] } } },
      { $group: { _id: null, totalLikes: { $sum: '$likes' }, totalShares: { $sum: '$shares' } } }
    ]);
    const totalLinkedinLikes = linkedinEngagementAgg?.[0]?.totalLikes || 0;
    const totalLinkedinShares = linkedinEngagementAgg?.[0]?.totalShares || 0;

    res.json({
      total,
      linkedinApproved,
      websiteApproved,
      pendingBlog,
      pendingLinkedin,
      rejectedTotal,
      rejectedBlog,
      rejectedLinkedin,
      totalBlogViews,
      totalLinkedinLikes,
      totalLinkedinShares,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPosts,
  getPost,
  approvePost,
  rejectPost,
  deletePost,
  createPost,
  getStats,
  updatePost,
  publishPost,
  unpublishPost,
};
