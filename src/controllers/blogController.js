// backend/src/controllers/blogController.js
const Post = require('../models/Post');
const Log = require('../models/Log');

// Format post for website display
const formatPostForWebsite = (post) => {
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
    seo: {
      title,
      description: post.excerpt,
      keywords: post.metadata?.keywords || ['tech', 'india', 'developers'],
      ogImage: post.featuredImage
    }
  };
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
    
    // Increment view count
    post.views = (post.views || 0) + 1;
    await post.save();
    
    res.json({
      success: true,
      post: formatPostForWebsite(post)
    });
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch post' 
    });
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
  getBlogMetadata
};