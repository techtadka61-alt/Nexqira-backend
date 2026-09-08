// backend/src/workers/post-scheduler.js
const cron = require('node-cron');
const newsService = require('../services/newsService');
const aiService = require('../services/aiService');
const imageService = require('../services/imageService');
const linkedinService = require('../services/linkedinService');
const { sendApprovalEmailForPost } = require('../services/approvalService');
const Post = require('../models/Post');
const Log = require('../models/Log');
const connectDB = require('../config/db');

class PostScheduler {
  constructor() {
    // TEST MODE (5 min): set SCHEDULER_TEST_MODE=true
    // Optional: force test mode regardless of env (useful for quick local testing)
    const forceTestMode = String(process.env.SCHEDULER_FORCE_TEST_MODE || '').toLowerCase() === 'true';
    const envTestMode = String(process.env.SCHEDULER_TEST_MODE || '').toLowerCase() === 'true';
    this.isTestMode = forceTestMode || envTestMode;

    // Har subah 9 bje scheduler chalega
    this.morningTime = process.env.SCHEDULER_MORNING_TIME || '09:00';
    // Aur shaam ko 5 bje scheduler chalega
    this.eveningTime = process.env.SCHEDULER_EVENING_TIME || '17:00';

    this.dedupWindowHours = parseInt(process.env.DEDUP_WINDOW_HOURS || '48', 10);
  }

  async initialize() {
    if (String(process.env.DISABLE_SCHEDULER || '').toLowerCase() === 'true') {
      console.log('⏸️ Scheduler disabled (DISABLE_SCHEDULER=true)');
      return;
    }

    console.log('\n🚀 Initializing Post Scheduler...');
    console.log('='.repeat(50));

    /*
    const intervalMs = 1 * 60 * 1000;
    const scheduleRelativeEveryMinute = () => {
      console.log(`⏳ First scheduler run in ~${Math.round(intervalMs / 60000)} minute (relative to server start)`);
      setTimeout(() => {
        const runOnce = async (label) => {
          try {
            console.log(`\n[${new Date().toISOString()}] 🔄 Running ${label} scheduler (every 1 min)...`);
            await this.generateAndPostToLinkedIn();
          } catch (err) {
            console.error('Scheduler run failed:', err?.message || err);
          }
        };

        // First run happens after interval.
        runOnce(this.isTestMode ? 'test' : 'continuous');

        // Subsequent runs every 1 minute after that.
        setInterval(() => runOnce(this.isTestMode ? 'test' : 'continuous'), intervalMs);
      }, intervalMs);
    };
    */

    if (this.isTestMode) {
      console.log('🧪 TEST MODE ENABLED');
      console.log('⏰ TEST MODE: Posts generation is currently paused (commented out)');
      // scheduleRelativeEveryMinute();
      console.log('='.repeat(50));

    } else {
      console.log('📅 PRODUCTION MODE');
      console.log(`🌅 Morning post: ${this.morningTime} IST`);
      console.log(`🌙 Evening post: ${this.eveningTime} IST (PAUSED/COMMENTED)`);
      console.log('='.repeat(50));

      // Production mode: Morning posts
      cron.schedule(this.getCronTime(this.morningTime), async () => {
        console.log(`\n[${new Date().toISOString()}] 🌅 Running Morning Scheduler...`);
        await this.generateAndPostToLinkedIn();
      }, { timezone: 'Asia/Kolkata' });

      // TEST: Every 2 minutes
      // cron.schedule('*/2 * * * *', async () => {
      //   console.log(`\n[${new Date().toISOString()}] ⏰ Running Test Scheduler (every 2 min)...`);
      //   await this.generateAndPostToLinkedIn();
      // });

      console.log('✅ Production schedule (9 AM) set up successfully\n');
    }
  }

  getCronTime(time) {
    const [hour, minute] = time.split(':');
    return `${minute} ${hour} * * *`;
  }

  isAdminApprovalRequired() {
    const raw = String(process.env.REQUIRE_ADMIN_APPROVAL || '').trim().toLowerCase();
    if (!raw) return true;
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  async generateAndPostToLinkedIn() {
    const startTime = Date.now();

    try {
      // Ensure DB is connected (scheduler can run outside Express request lifecycle)
      await connectDB();

      console.log('\n📰 Fetching latest tech news...');

      // Fetch news
      const articles = await newsService.fetchTechNews({ target: 'linkedin' });
      const relevantArticles = await newsService.filterRelevantNews(articles);

      if (relevantArticles.length === 0) {
        console.log('⚠️ No relevant articles found');
        await this.createLog('No relevant articles found', 'warn');
        return;
      }

      // Rank by relevance/importance, then pick first non-duplicate
      const rankedArticles = this.rankArticles(relevantArticles);

      // Select first non-duplicate article
      // Optimization: Fetch all recent source URLs in one query
      const recentUrls = await this.getRecentSourceUrls();
      const topArticle = rankedArticles.find(article => !recentUrls.has(article.url));

      if (!topArticle) {
        console.log('⚠️ All relevant articles were recently processed (dedup).');
        await this.createLog('All relevant articles skipped by dedup', 'warn', {
          windowHours: this.dedupWindowHours,
          candidateCount: relevantArticles.length
        });
        return;
      }


      console.log(`✅ Selected article: ${topArticle.title}`);
      console.log(`📌 Source: ${topArticle.source}`);

      const requireApproval = this.isAdminApprovalRequired();

      // Parallelize AI generation and Image fetching to save time
      console.log('\n🤖 Generating content and fetching image in parallel...');
      
      const [linkedInPost, imageUrl] = await Promise.all([
        aiService.generateSEOFriendlyLinkedInPost(topArticle),
        imageService.generateOrFetchImage(topArticle)
      ]);
      
      const blogContent = {
        title: topArticle.title,
        content: "Content pending generation by admin...",
        excerpt: topArticle.description?.substring(0, 200) || ""
      };

      console.log('\n📝 LinkedIn Content Generated');
      console.log(`🖼️ Image URL: ${imageUrl}`);
      if (requireApproval) console.log('📝 Blog Content Generated');

      if (requireApproval) {
        console.log('\n🛡️ REQUIRE_ADMIN_APPROVAL=true → saving as pending draft (no auto publish)');

        const slug = topArticle.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') + '-' + Date.now();

        const draft = await Post.create({
          title: blogContent.title,
          blogTitle: blogContent.title,
          linkedInTitle: blogContent.title,
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
          linkedInContent: linkedInPost.content,
          featuredImage: imageUrl,
          category: 'Technology',
          metadata: {
            ...(linkedInPost || {}),
            aiModel: aiService.provider || 'gemini',
            articleUrl: topArticle.url,
            categories: ['Technology'],
            platformStatus: {
              blog: { status: 'pending' },
              linkedin: { status: 'pending' }
            }
          }
        });

        await this.createLog('Draft created (admin approval required)', 'info', {
          postId: draft._id,
          source: topArticle.source,
          requireApproval
        });

        try {
          const emailResult = await sendApprovalEmailForPost(draft);
          await this.createLog('Approval email sent for pending draft', 'info', {
            postId: draft._id,
            to: emailResult.to
          });
        } catch (approvalErr) {
          console.warn(`⚠️ Approval notification skipped: ${approvalErr.message}`);
          await this.createLog('Approval email could not be sent', 'warn', {
            postId: draft._id,
            error: approvalErr.message
          });
        }

        return;
      }


      // Post to LinkedIn (non-fatal)
      console.log('\n📤 Posting to LinkedIn...');
      let result = { success: false };
      try {
        // Default: do NOT include images on LinkedIn unless enabled
        const useImageOnLinkedIn = String(process.env.LINKEDIN_USE_IMAGE || '').toLowerCase() === 'true';
        result = await linkedinService.postToLinkedIn(
          linkedInPost.content,
          useImageOnLinkedIn ? imageUrl : null,
          linkedInPost.hashtags
        );
      } catch (lnErr) {
        console.error('❌ LinkedIn post error:', lnErr.response?.data || lnErr.message || lnErr);
        // Continue flow: record failure but do not throw
        result = { success: false, error: lnErr.response?.data || lnErr.message };
      }

      // Save post to database
      const post = await this.savePostToDatabase(topArticle, linkedInPost, imageUrl, result);

      // Also generate and post to the blog (nexqira.online)
      try {
        await this.generateAndPostToBlog(topArticle, linkedInPost, imageUrl);
      } catch (blogErr) {
        console.error('Error generating/posting blog:', blogErr.message || blogErr);
        await this.createLog(`Blog publish failed: ${blogErr.message || blogErr}`, 'error', { error: blogErr.message });
      }

      const duration = Date.now() - startTime;
      if (result?.success) {
        console.log(`\n✅ Successfully posted to LinkedIn! (${duration}ms)`);
        console.log(`📊 Post ID: ${result.postId || 'N/A'}`);
        console.log(`🔗 View at: ${result.postUrl || 'LinkedIn profile'}`);
      } else {
        console.log(`\n⚠️ LinkedIn post not published (continuing). (${duration}ms)`);
      }

      await this.createLog(
        result?.success
          ? `Successfully posted to LinkedIn: ${topArticle.title}`
          : `LinkedIn publish failed (blog may still be published): ${topArticle.title}`,
        result?.success ? 'info' : 'warn',
        { postId: post._id, duration, seoScore: linkedInPost.seoScore, linkedInSuccess: !!result?.success }
      );

    } catch (error) {
      console.error('\n❌ Error in post generation:', error.message);
      await this.createLog(
        `Failed to post to LinkedIn: ${error.message}`,
        'error',
        { error: error.message }
      );
    }
  }

  async getRecentSourceUrls() {
    try {
      const since = new Date(Date.now() - this.dedupWindowHours * 60 * 60 * 1000);
      const recentPosts = await Post.find({
        createdAt: { $gte: since },
        'sourceNews.url': { $exists: true }
      }).select('sourceNews.url');
      
      return new Set(recentPosts.map(p => p.sourceNews.url));
    } catch (err) {
      console.error('Error fetching recent URLs:', err);
      return new Set();
    }
  }

  async findRecentPostBySourceUrl(url) {

    try {
      if (!url) return null;
      const since = new Date(Date.now() - this.dedupWindowHours * 60 * 60 * 1000);
      return await Post.findOne({
        'sourceNews.url': url,
        createdAt: { $gte: since }
      }).sort({ createdAt: -1 });
    } catch (err) {
      // If dedup fails, do not block posting
      return null;
    }
  }

  rankArticles(articles) {
    const now = Date.now();
    const keywordWeights = [
      { k: 'artificial intelligence', w: 8 },
      { k: 'machine learning', w: 8 },
      { k: 'genai', w: 8 },
      { k: 'llm', w: 7 },
      { k: 'ai', w: 6 },
      { k: 'ml', w: 4 },
      { k: 'cybersecurity', w: 8 },
      { k: 'cyber security', w: 8 },
      { k: 'vulnerability', w: 8 },
      { k: 'cve', w: 8 },
      { k: 'breach', w: 7 },
      { k: 'ransomware', w: 7 },
      { k: 'hacker', w: 6 },
      { k: 'hacking', w: 6 },
      { k: 'security', w: 5 },
      { k: 'job', w: 6 },
      { k: 'hiring', w: 6 },
      { k: 'layoff', w: 6 },
      { k: 'release', w: 5 },
      { k: 'released', w: 5 },
      { k: 'update', w: 4 },
      { k: 'version', w: 4 },
      { k: 'npm', w: 6 },
      { k: 'package', w: 5 },
      { k: 'open source', w: 4 },
      { k: 'next.js', w: 6 },
      { k: 'nextjs', w: 6 },
      { k: 'react', w: 5 },
      { k: 'node.js', w: 5 },
      { k: 'node', w: 3 },
      { k: 'typescript', w: 5 },
      { k: 'javascript', w: 5 },
      { k: 'python', w: 5 },
      { k: 'developer', w: 4 },
      { k: 'developers', w: 4 },
      { k: 'programming', w: 4 },
      { k: 'software', w: 4 },
      { k: 'startup', w: 3 },
      { k: 'startups', w: 3 },
      { k: 'india', w: 3 },
      { k: 'indian', w: 3 },
      { k: 'tech', w: 2 },
      { k: 'technology', w: 2 }
    ];

    const scoreOne = (a) => {
      const text = `${a.title || ''} ${a.description || ''}`.toLowerCase();
      let score = 0;

      for (const kw of keywordWeights) {
        if (text.includes(kw.k)) score += kw.w;
      }

      // Prefer fresher news (max +6 points, decays over 48 hours)
      const published = a.publishedAt ? new Date(a.publishedAt).getTime() : now;
      const ageHours = Math.max(0, (now - published) / (1000 * 60 * 60));
      const freshness = Math.max(0, 6 - ageHours / 8); // ~6..0 over ~48h
      score += freshness;

      return score;
    };

    return [...articles].sort((a, b) => scoreOne(b) - scoreOne(a));
  }

  // Add this method to the PostScheduler class
  async generateAndPostToBlog(news, linkedInPost, imageUrl) {
    try {
      console.log('\n📝 Preparing blog post for nexqira.online...');

      // Generate blog content with full HTML formatting
      const blogContent = await aiService.generateBlogPost(news);

      // Create blog post data
      const blogPostData = {
        title: blogContent.title,
        slug: news.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') + '-' + Date.now(),
        content: this.formatBlogContent(blogContent.content),
        excerpt: blogContent.excerpt,
        featuredImage: imageUrl,
        status: 'published',
        platforms: ['blog'],
        sourceNews: {
          title: news.title,
          url: news.url,
          source: news.source,
          publishedAt: new Date(news.publishedAt)
        },
        publishedAt: new Date(),
        metadata: {
          categories: ['Technology', 'Tech News'],
          tags: ['tech', 'india', 'developers', 'news'],
          seoScore: 85,
          readingTime: this.calculateReadingTime(blogContent.content),
          keywords: ['technology', 'india', 'developers', 'tech news']
        }
      };

      // Save to database
      const post = new Post(blogPostData);
      await post.save();

      console.log(`✅ Blog post saved: ${post.title}`);
      console.log(`🔗 View at: https://nexqira.online/blog/${post.slug}`);

      return post;

    } catch (error) {
      console.error('Error creating blog post:', error);
      throw error;
    }
  }

  formatBlogContent(content) {
    // Add HTML formatting for better blog display
    return `
    <div class="blog-content">
      ${content.split('\n\n').map(para => `<p>${para}</p>`).join('')}
      
      <div class="blog-footer">
        <hr />
        <p><strong>Source:</strong> Tech News Automation</p>
        <p><strong>Stay Updated:</strong> Follow us for more tech insights!</p>
      </div>
    </div>
  `;
  }

  calculateReadingTime(content) {
    const wordsPerMinute = 200;
    const words = content.trim().split(/\s+/).length;
    const minutes = Math.ceil(words / wordsPerMinute);
    return `${minutes} min read`;
  }

  async savePostToDatabase(article, linkedInPost, imageUrl, linkedInResult) {
    try {
      const slug = article.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') + '-' + Date.now();

      const post = new Post({
        title: article.title,
        slug,
        content: linkedInPost.content,
        excerpt: linkedInPost.excerpt || article.description.substring(0, 200),
        featuredImage: imageUrl,
        status: linkedInResult?.success ? 'published' : 'failed',
        platforms: ['linkedin'],
        sourceNews: {
          title: article.title,
          url: article.url,
          source: article.source,
          publishedAt: new Date(article.publishedAt)
        },
        linkedInContent: linkedInPost.content,
        publishedAt: new Date(),
        metadata: {
          seoScore: linkedInPost.seoScore,
          hashtags: linkedInPost.hashtags,
          keywords: linkedInPost.keywords,
          readabilityScore: linkedInPost.readabilityScore,
          linkedInPostId: linkedInResult?.postId,
          linkedInError: linkedInResult?.success ? undefined : linkedInResult?.error,
          imageSource: imageUrl.includes('unsplash') ? 'unsplash' :
            imageUrl.includes('pexels') ? 'pexels' : 'generated'
        }
      });

      await post.save();
      console.log(`💾 Post saved to database with ID: ${post._id}`);
      return post;

    } catch (error) {
      console.error('Error saving post:', error);
      throw error;
    }
  }

  async createLog(message, level = 'info', metadata = {}) {
    try {
      const log = new Log({
        level,
        message,
        category: 'scheduler',
        metadata,
        createdAt: new Date()
      });
      await log.save();
    } catch (error) {
      console.error('Error creating log:', error);
    }
  }
}

module.exports = PostScheduler;