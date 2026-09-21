// backend/src/controllers/blogController.js
const Post = require('../models/Post');
const Log = require('../models/Log');
const PostView = require('../models/PostView');
const PostLike = require('../models/PostLike');
const { getClientIp, hashVisitor } = require('../utils/visitorHash');

// Format post for website display
const formatPostForWebsite = (post, viewerHasLiked) => {
  const title = post.blogTitle || post.title;
  const primaryCategory = post.category || post.metadata?.categories?.[0] || 'Technology';
  return {
    id: post._id,
    title,
    slug: post.slug,
    excerpt: post.excerpt,
    content: post.content,
    featuredImage: post.featuredImage,
    publishedAt: post.publishedAt || post.createdAt,
    author: 'Tech Tadka Team',
    categories: [primaryCategory, ...(post.metadata?.categories || []).filter((c) => c && c !== primaryCategory)],
    tags: post.metadata?.tags || [],
    readingTime: calculateReadingTime(post.content),
    views: post.views || 0,
    likes: post.likes || 0,
    ...(viewerHasLiked !== undefined ? { viewerHasLiked } : {}),
    seo: {
      title,
      description: post.excerpt,
      keywords: post.metadata?.keywords || ['tech', 'india', 'developers'],
      ogImage: post.featuredImage
    }
  };
};

// Resolve a stable per-visitor hash for view/like deduplication, preferring
// a client-generated id (already used by the analytics tracker) and falling
// back to IP + user-agent for clients that don't send one.
const resolveVisitorHash = (req) => {
  const clientId = String(req.body?.clientId || req.query?.clientId || '').trim().slice(0, 100) || null;
  const ip = getClientIp(req);
  const userAgent = req.get('user-agent');
  return hashVisitor({ ip, userAgent, clientId });
};

// Calculate reading time
const calculateReadingTime = (content) => {
  const wordsPerMinute = 200;
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / wordsPerMinute);
  return `${minutes} min read`;
};

// Get all published posts for website
const getWebsitePosts = async (req, res) => {
  try {
    const { page = 1, limit = 10, category, tag } = req.query;
    
    const query = { 
      status: 'published',
      platforms: { $in: ['blog'] }
    };
    
    if (category) {
      query.$or = [
        { category },
        { 'metadata.categories': category }
      ];
    }
    if (tag) query['metadata.tags'] = tag;
    
    const posts = await Post.find(query)
      .sort({ publishedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-linkedInContent -metadata.linkedInPost');
    
    const total = await Post.countDocuments(query);
    
    const formattedPosts = posts.map(formatPostForWebsite);
    
    res.json({
      success: true,
      posts: formattedPosts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching website posts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch posts' 
    });
  }
};

// Get single post by slug for website
const getWebsitePostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    
    const post = await Post.findOne({ 
      slug, 
      status: 'published',
      platforms: { $in: ['blog'] }
    }).select('-linkedInContent -metadata.linkedInPost');
    
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const visitorHash = resolveVisitorHash(req);

    // Only count a view the first time this visitor is seen for this post
    // within the dedup window (see PostView's TTL index). The unique index
    // on {postId, visitorHash} makes this safe under concurrent requests —
    // a duplicate insert simply throws E11000, which we ignore.
    try {
      await PostView.create({ postId: post._id, visitorHash });
      post.views = (post.views || 0) + 1;
      await Post.updateOne({ _id: post._id }, { $inc: { views: 1 } });
    } catch (err) {
      if (err.code !== 11000) throw err;
    }

    const viewerHasLiked = Boolean(await PostLike.exists({ postId: post._id, visitorHash }));

    res.json({
      success: true,
      post: formatPostForWebsite(post, viewerHasLiked)
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
};

// Toggle like/unlike for a post, deduped per-visitor the same way as views.
const toggleLike = async (req, res) => {
  try {
    const { slug } = req.params;

    const post = await Post.findOne({
      slug,
      status: 'published',
      platforms: { $in: ['blog'] }
    }).select('_id likes');

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const visitorHash = resolveVisitorHash(req);
    const existing = await PostLike.findOne({ postId: post._id, visitorHash });

    let liked;
    if (existing) {
      await PostLike.deleteOne({ _id: existing._id });
      await Post.updateOne({ _id: post._id }, { $inc: { likes: -1 } });
      liked = false;
    } else {
      try {
        await PostLike.create({ postId: post._id, visitorHash });
        await Post.updateOne({ _id: post._id }, { $inc: { likes: 1 } });
        liked = true;
      } catch (err) {
        // Duplicate like from a concurrent request — treat as already liked.
        if (err.code !== 11000) throw err;
        liked = true;
      }
    }

    const updated = await Post.findById(post._id).select('likes');

    res.json({
      success: true,
      liked,
      likes: updated?.likes || 0
    });
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ success: false, message: 'Failed to update like' });
  }
};

// Get related posts
const getRelatedPosts = async (req, res) => {
  try {
    const { postId } = req.params;
    
    const currentPost = await Post.findById(postId);
    if (!currentPost) {
      return res.status(404).json({ 
        success: false, 
        message: 'Post not found' 
      });
    }
    
    const relatedPosts = await Post.find({
      _id: { $ne: postId },
      status: 'published',
      platforms: { $in: ['blog'] },
      $or: [
        { category: currentPost.category },
        { 'metadata.categories': { $in: currentPost.metadata?.categories || [] } }
      ]
    })
    .limit(3)
    .sort({ publishedAt: -1 });
    
    res.json({
      success: true,
      posts: relatedPosts.map(formatPostForWebsite)
    });
  } catch (error) {
    console.error('Error fetching related posts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch related posts' 
    });
  }
};

// Get blog categories and tags (for filtering)
const getBlogMetadata = async (req, res) => {
  try {
    const posts = await Post.find({ 
      status: 'published',
      platforms: { $in: ['blog'] }
    });
    
    const categories = new Set();
    const tags = new Set();
    
    posts.forEach(post => {
      if (post.metadata?.categories) {
        post.metadata.categories.forEach(cat => categories.add(cat));
      }
      if (post.metadata?.tags) {
        post.metadata.tags.forEach(tag => tags.add(tag));
      }
    });
    
    res.json({
      success: true,
      categories: Array.from(categories),
      tags: Array.from(tags),
      totalPosts: posts.length
    });
  } catch (error) {
    console.error('Error fetching blog metadata:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch metadata' 
    });
  }
};

module.exports = {
  getWebsitePosts,
  getWebsitePostBySlug,
  getRelatedPosts,
  getBlogMetadata,
  toggleLike
};