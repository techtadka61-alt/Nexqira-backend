// backend/src/services/imageService.js
const axios = require('axios');

class ImageService {
  async generateOrFetchImage(news, postContent = '') {
    try {
      const combinedText = `${news?.title || ''} ${news?.description || ''} ${postContent || ''}`;
      const keywordQuery = this.buildUnsplashQuery(combinedText);

      // Try Unsplash first
      const unsplashImage = await this.fetchFromUnsplash(keywordQuery);
      if (unsplashImage) {
        console.log('📸 Image fetched from Unsplash');
        return unsplashImage;
      }
      
      // Try Pexels as fallback
      const pexelsImage = await this.fetchFromPexels(keywordQuery);
      if (pexelsImage) {
        console.log('📸 Image fetched from Pexels');
        return pexelsImage;
      }
      
      // Final fallback
      console.log('🖼️ Using placeholder image');
      return this.getPlaceholderImage(news.title);
      
    } catch (error) {
      console.error('Error fetching image:', error);
      return this.getPlaceholderImage(news.title);
    }
  }

  buildUnsplashQuery(text) {
    const lower = String(text || '').toLowerCase();

    const topicHints = [];
    const addHint = (hint) => {
      if (hint && !topicHints.includes(hint)) topicHints.push(hint);
    };

    // Topic inference (keep it “photo-friendly”)
    if (/(cyber|cybersecurity|hacker|hacking|breach|ransomware|cve|vulnerability)/.test(lower)) {
      addHint('cybersecurity');
      addHint('hacker');
    } else if (/(ai|artificial intelligence|machine learning|llm|genai)/.test(lower)) {
      addHint('artificial intelligence');
      addHint('machine learning');
    } else if (/(job|hiring|layoff|career)/.test(lower)) {
      addHint('career');
      addHint('office');
    } else if (/(react|next\.js|nextjs|node\.js|node|javascript|typescript|python|npm|package)/.test(lower)) {
      addHint('coding');
      addHint('software development');
    } else {
      addHint('technology');
    }

    // Lightweight keyword extraction (avoid long/irrelevant queries)
    const stop = new Set([
      'the','a','an','and','or','to','of','in','for','on','with','by','from','as','at','is','are','was','were','be','been','it','this','that',
      'india','indian','tech','technology','software','developer','developers','news','latest','new'
    ]);
    const words = lower
      .replace(/[^a-z0-9\s\.\-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => w.length >= 4 && !stop.has(w));

    const freq = new Map();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const topWords = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w);

    const queryParts = [...topicHints, ...topWords, 'technology'];
    const query = queryParts.join(' ').trim();
    return query.length > 80 ? query.slice(0, 80) : query;
  }

  async fetchFromUnsplash(query) {
    try {
      // Prefer explicit access key if both are present
      const accessKey = process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_API_KEY;
      if (!accessKey) return null;

      const response = await axios.get('https://api.unsplash.com/search/photos', {
        params: {
          query: String(query || 'technology').trim(),
          per_page: 3,
          orientation: 'landscape',
          content_filter: 'high'
        },
        headers: {
          'Authorization': `Client-ID ${accessKey}`
        },
        timeout: 5000
      });

      if (response.data.results && response.data.results.length > 0) {
        const image = response.data.results[0];
        return image.urls.regular + '&w=1200&h=630&fit=crop';
      }

      // Optional generic fallback (not related, but better than nothing)
      if (String(process.env.UNSPLASH_FALLBACK_PHOTOS || '').toLowerCase() === 'true') {
        const photos = await axios.get('https://api.unsplash.com/photos', {
          params: { per_page: 1, order_by: 'popular' },
          headers: { 'Authorization': `Client-ID ${accessKey}` },
          timeout: 5000
        });
        if (Array.isArray(photos.data) && photos.data[0]?.urls?.regular) {
          return photos.data[0].urls.regular + '&w=1200&h=630&fit=crop';
        }
      }
      return null;
    } catch (error) {
      const status = error.response?.status;
      console.error('Unsplash error:', status ? `${status}` : error.message);
      return null;
    }
  }

  async fetchFromPexels(query) {
    try {
      if (!process.env.PEXELS_API_KEY) return null;
      const response = await axios.get('https://api.pexels.com/v1/search', {
        params: {
          query: String(query || 'technology'),
          per_page: 1,
          orientation: 'landscape'
        },
        headers: {
          'Authorization': process.env.PEXELS_API_KEY
        },
        timeout: 5000
      });

      if (response.data.photos && response.data.photos.length > 0) {
        return response.data.photos[0].src.large2x;
      }
      return null;
    } catch (error) {
      console.error('Pexels error:', error.message);
      return null;
    }
  }

  getPlaceholderImage(title) {
    const encodedTitle = encodeURIComponent(title.substring(0, 50));
    return `https://placehold.co/1200x630/0066cc/white?text=${encodedTitle}`;
  }
}

module.exports = new ImageService();