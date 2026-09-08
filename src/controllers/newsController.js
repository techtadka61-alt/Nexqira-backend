const newsService = require('../services/newsService');
const aiService = require('../services/aiService');
const Post = require('../models/Post');
const Log = require('../models/Log');

// Generate news post with Groq
const generateNewsPost = async (req, res) => {
  try {
    // Fetch news
    const articles = await newsService.fetchTechNews();
    const relevant = await newsService.filterRelevantNews(articles);

    if (relevant.length === 0) {
      return res.status(404).json({ message: 'No relevant news found' });
    }

    const topArticle = relevant[0];

    // Generate content with Groq
    const blogContent = await aiService.generateBlogPost(topArticle);
    const linkedInContent = await aiService.generateLinkedInPost(topArticle, blogContent);
    
    // Generate image prompt and get image (optional)
    const imagePrompt = await aiService.generateImagePrompt(topArticle);

    // Create slug
    const slug = topArticle.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') + '-' + Date.now();

    // Create pending post
    const post = await Post.create({
      title: blogContent.title,
      slug,
      content: blogContent.content,
      excerpt: blogContent.excerpt,
      status: 'pending',
      platforms: ['blog', 'linkedin'],
      sourceNews: {
        title: topArticle.title,
        url: topArticle.url,
        source: topArticle.source,
        publishedAt: topArticle.publishedAt,
      },
      linkedInContent: linkedInContent.content,
      featuredImage: `https://placehold.co/1200x630/0066cc/white?text=${encodeURIComponent(blogContent.title)}`,
      metadata: {
        aiModel: aiService.provider || 'gemini',
        imagePrompt: imagePrompt,
        articleUrl: topArticle.url,
        platformStatus: {
          blog: { status: 'pending' },
          linkedin: { status: 'pending' }
        }
      }
    });

    await Log.create({
      level: 'info',
      message: `News post generated with ${aiService.provider || 'AI'}: ${post.title}`,
      category: 'news',
      postId: post._id,
      metadata: { 
        source: topArticle.source,
        aiModel: aiService.provider || 'gemini'
      },
    });

    res.status(201).json({
      success: true,
      message: 'News post generated successfully',
      post
    });
  } catch (error) {
    console.error('Error generating news:', error);
    
    await Log.create({
      level: 'error',
      message: `Failed to generate news post: ${error.message}`,
      category: 'news',
      metadata: { error: error.message },
    });
    
    res.status(500).json({ 
      success: false,
      message: 'Failed to generate news post',
      error: error.message 
    });
  }
};

// Generate multiple news posts (batch)
const generateBatchNews = async (req, res) => {
  try {
    const { count = 3 } = req.body;
    
    const articles = await newsService.fetchTechNews();
    const relevant = await newsService.filterRelevantNews(articles);
    
    if (relevant.length === 0) {
      return res.status(404).json({ message: 'No relevant news found' });
    }
    
    const posts = [];
    for (let i = 0; i < Math.min(count, relevant.length); i++) {
      const article = relevant[i];
      
      const blogContent = await aiService.generateBlogPost(article);
      const linkedInContent = await aiService.generateLinkedInPost(article, blogContent);
      
      const slug = article.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') + '-' + Date.now() + '-' + i;
      
      const post = await Post.create({
        title: blogContent.title,
        slug,
        content: blogContent.content,
        excerpt: blogContent.excerpt,
        status: 'pending',
        platforms: ['blog', 'linkedin'],
        sourceNews: {
          title: article.title,
          url: article.url,
          source: article.source,
          publishedAt: article.publishedAt,
        },
        linkedInContent: linkedInContent.content,
      });
      
      posts.push(post);
      
      await Log.create({
        level: 'info',
        message: `Batch post generated: ${post.title}`,
        category: 'news',
        postId: post._id,
      });
    }
    
    res.status(201).json({
      success: true,
      message: `${posts.length} news posts generated`,
      posts
    });
  } catch (error) {
    console.error('Error generating batch news:', error);
    res.status(500).json({ message: error.message });
  }
};

// Test Groq API connection (route kept as /test-grok for backward compatibility)
const testGrokAPI = async (req, res) => {
  try {
    const testPrompt = "Generate a short welcome message for Indian tech developers";
    const response = await aiService.callGrokAPI(testPrompt, 100);
    
    res.json({
      success: true,
      message: `${aiService.provider} is working`,
      response: response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `${aiService.provider} test failed`,
      error: error.message
    });
  }
};

module.exports = { 
  generateNewsPost, 
  generateBatchNews,
  testGrokAPI 
};