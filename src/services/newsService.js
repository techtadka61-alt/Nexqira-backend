const axios = require('axios');
const RSSParser = require('rss-parser');

const parser = new RSSParser();

function parseUrlList(raw) {
  return String(raw || '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const url = String(item?.url || '').trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(item);
  }
  return out;
}

function normalizeArticle(partial, fallbackSource) {
  return {
    title: String(partial.title || '').trim(),
    description: String(partial.description || partial.summary || '').trim(),
    content: String(partial.content || '').trim(),
    url: String(partial.url || partial.link || '').trim(),
    publishedAt: partial.publishedAt || partial.isoDate || partial.pubDate || null,
    source: String(partial.source || fallbackSource || '').trim(),
  };
}

async function fetchDevToArticles(apiUrl) {
  const res = await axios.get(apiUrl, { timeout: 15000 });
  const list = Array.isArray(res.data) ? res.data : [];
  return list.map((a) => normalizeArticle({
    title: a.title,
    description: a.description || a.social_image || a.description,
    url: a.url,
    publishedAt: a.published_at,
    source: 'Dev.to',
  }, 'Dev.to'));
}

async function fetchRedditSubreddit(subredditUrl) {
  const base = subredditUrl.replace(/\/$/, '');
  const url = base.endsWith('.json') ? base : `${base}.json`;
  const res = await axios.get(url, {
    params: { limit: 25 },
    timeout: 15000,
    headers: {
      // Reddit blocks requests without UA sometimes
      'User-Agent': 'tech-news-automation/1.0 (server)'
    }
  });
  const children = res.data?.data?.children || [];
  return children
    .map((c) => c?.data)
    .filter(Boolean)
    .map((p) => normalizeArticle({
      title: p.title,
      description: p.selftext ? String(p.selftext).slice(0, 300) : '',
      url: p.url_overridden_by_dest || p.url,
      publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
      source: `Reddit r/${p.subreddit}`
    }, 'Reddit'));
}

async function fetchHackerNews(query) {
  const q = String(query || '').trim() || 'javascript OR typescript OR react OR next.js OR node OR ai OR security';
  const res = await axios.get('https://hn.algolia.com/api/v1/search_by_date', {
    params: {
      tags: 'story',
      query: q,
      hitsPerPage: 25,
    },
    timeout: 15000,
  });
  const hits = res.data?.hits || [];
  return hits
    .filter((h) => h?.title && h?.url)
    .map((h) => normalizeArticle({
      title: h.title,
      description: h.story_text || h.comment_text || '',
      url: h.url,
      publishedAt: h.created_at,
      source: 'Hacker News'
    }, 'Hacker News'));
}

async function fetchRss(feedUrl) {
  const feed = await parser.parseURL(feedUrl);
  const source = feed.title || feedUrl;
  const items = Array.isArray(feed.items) ? feed.items : [];
  return items.map((it) => normalizeArticle({
    title: it.title,
    description: it.contentSnippet || it.summary || '',
    content: it.content || '',
    url: it.link,
    publishedAt: it.isoDate || it.pubDate,
    source,
  }, source));
}

async function fetchFromSourceUrl(sourceUrl) {
  const url = String(sourceUrl || '').trim();
  if (!url) return [];

  // Dev.to API
  if (/dev\.to\/api\/articles/i.test(url)) {
    return fetchDevToArticles(url);
  }

  // Reddit subreddit
  if (/reddit\.com\/r\//i.test(url)) {
    return fetchRedditSubreddit(url);
  }

  // Hacker News (given site URL) - we use Algolia for listing
  if (/news\.ycombinator\.com\/?$/i.test(url) || /news\.ycombinator\.com/i.test(url)) {
    const hnQuery = process.env.HN_QUERY;
    return fetchHackerNews(hnQuery);
  }

  // RSS/Atom feeds
  if (/(\.xml$|\.rss$|\/feed\/?$|\/rss\/?$|\/atom\/?$|feed\.xml$|rss\.xml$)/i.test(url)) {
    return fetchRss(url);
  }

  // Unknown type: skip (user should provide RSS/API/JSON URLs)
  console.warn(`⚠️ Skipping unsupported source URL (provide RSS/API/JSON): ${url}`);
  return [];
}

const fetchTechNews = async (opts = {}) => {
  try {
    const explicit = parseUrlList(process.env.TECH_NEWS_SOURCE_URLS);
    const linkedin = parseUrlList(process.env.LINKEDIN_SOURCE_URLS);
    const website = parseUrlList(process.env.WEBSITE_SOURCE_URLS);

    // If caller specified target, prefer that list.
    const target = String(opts.target || '').toLowerCase();
    let urls = explicit;
    if (urls.length === 0) {
      if (target === 'linkedin') urls = linkedin;
      else if (target === 'website' || target === 'blog') urls = website;
      else urls = [...linkedin, ...website];
    }

    // Default to Dev.to JS feed if nothing configured
    if (urls.length === 0) {
      urls = ['https://dev.to/api/articles?tag=javascript'];
    }

    const all = [];
    // Parallel fetch from all sources with a global 3s timeout
    const fetchPromises = urls.map(async (u) => {
      try {
        return await axios.get(u, { timeout: 3000 }).then(res => fetchFromSourceUrl(u)); // This is a bit redundant but ensures timeout
      } catch (e) {
        // Fallback to direct fetch if axios wrapper is weird
        try {
           return await fetchFromSourceUrl(u);
        } catch(ee) {
           console.warn(`⚠️ Failed source fetch: ${u} → ${ee.message || ee}`);
           return [];
        }
      }
    });


    const results = await Promise.all(fetchPromises);
    results.forEach(items => all.push(...items));

    const unique = uniqByUrl(all);
    if (unique.length > 0) return unique;

    // Optional fallback to GNews (disabled by default)
    const allowGnews = String(process.env.ALLOW_GNEWS_FALLBACK || '').toLowerCase() === 'true';
    if (!allowGnews) return [];

    const defaultQuery =
      'AI OR cybersecurity OR breach OR CVE OR ransomware OR javascript OR python OR react OR nextjs OR node OR npm OR release OR update OR hiring OR layoff';

    const candidateQuery = String(process.env.GNEWS_QUERY || '').trim();
    const q = candidateQuery
      ? (candidateQuery.length <= 200 ? candidateQuery : defaultQuery)
      : defaultQuery;

    const response = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        q,
        lang: 'en',
        country: 'in',
        max: 25,
        apikey: process.env.GNEWS_API_KEY,
      },
      timeout: 10000,
    });

    return (response.data.articles || []).map((article) => normalizeArticle({
      title: article.title,
      description: article.description,
      content: article.content,
      url: article.url,
      publishedAt: article.publishedAt,
      source: article.source?.name,
    }, article.source?.name));
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    console.error('Error fetching news:', status ? `HTTP ${status}` : '', data || error.message);
    return [];
  }
};

const filterRelevantNews = async (articles) => {
  const keywords = [
    // Core
    'developer', 'developers', 'programming', 'software', 'technology',

    // AI/ML
    'ai', 'artificial intelligence', 'machine learning', 'llm', 'genai',

    // Security
    'cyber', 'cybersecurity', 'hack', 'hacker', 'hacking', 'breach', 'leak', 'ransomware', 'vulnerability', 'cve',

    // Jobs
    'job', 'jobs', 'hiring', 'layoff', 'recruit',

    // Ecosystem
    'javascript', 'typescript', 'python', 'react', 'next.js', 'nextjs', 'node', 'node.js', 'npm', 'package',

    // Releases/versions
    'release', 'released', 'update', 'updated', 'version',

    // India focus (optional boost)
    'india', 'indian', 'startup', 'startups'
  ];

  return articles.filter(article => {
    const text = `${article.title} ${article.description}`.toLowerCase();
    return keywords.some(keyword => text.includes(keyword));
  });
};

module.exports = { fetchTechNews, filterRelevantNews };