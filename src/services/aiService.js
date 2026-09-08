const axios = require('axios');
const OpenAI = require('openai');

class AIService {
  constructor() {
    const rawProvider = String(process.env.AI_PROVIDER || '').trim().toLowerCase();

    // Gemini (Primary)
    this.geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();
    this.geminiBaseURL = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    this.geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    // Groq (OpenAI-compatible)
    this.groqApiKey = String(process.env.GROQ_API_KEY || '').trim();
    this.groqBaseURL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
    this.groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    // Legacy xAI Grok (only if explicitly enabled)
    this.grokApiKey = String(process.env.GROK_API_KEY || '').trim();
    this.grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';
    this.grokModel = process.env.GROK_MODEL || 'grok-beta';

    // Backward compatible provider selection:
    // - If AI_PROVIDER is set, respect it.
    // - Else, prefer Groq when GROQ_API_KEY exists.
    // - Else, use Gemini when GEMINI_API_KEY exists.
    // - Else, use Grok when GROK_API_KEY exists.
    // - Else default to gemini (will error clearly).
    this.provider = rawProvider || (this.groqApiKey ? 'groq' : this.geminiApiKey ? 'gemini' : this.grokApiKey ? 'grok' : 'groq');

    if (this.provider === 'groq' || this.provider === 'gemini') {
      // IMPORTANT: OpenAI SDK throws if apiKey is missing; initialize lazily.
      this.client = null;
    }
  }

  assertConfigured() {
    if (this.provider === 'gemini') {
      if (!this.geminiApiKey) {
        throw new Error('GEMINI_API_KEY is not configured (set AI_PROVIDER=gemini and provide GEMINI_API_KEY in backend/.env)');
      }
      return;
    }

    if (this.provider === 'grok') {
      if (!this.grokApiKey) {
        throw new Error('GROK_API_KEY is not configured (set AI_PROVIDER=grok and provide GROK_API_KEY in backend/.env)');
      }
      return;
    }

    // Default: groq
    if (!this.groqApiKey) {
      const hasGeminiKey = !!this.geminiApiKey;
      const hasGrokKey = !!this.grokApiKey;
      throw new Error(
        hasGeminiKey
          ? 'GROQ_API_KEY is not configured (you have GEMINI_API_KEY set; either set AI_PROVIDER=gemini or provide a Groq key)'
          : hasGrokKey
          ? 'GROQ_API_KEY is not configured (you have GROK_API_KEY set; either set AI_PROVIDER=grok or provide a Groq key)'
          : 'GROQ_API_KEY is not configured (set AI_PROVIDER=groq/gemini and provide the corresponding key in backend/.env)'
      );
    }
  }

  async callAI(prompt, maxTokens = 1000) {
    this.assertConfigured();

    if (this.provider === 'grok') {
      try {
        const response = await axios.post(
          this.grokApiUrl,
          {
            model: this.grokModel,
            messages: [
              {
                role: 'system',
                content:
                  'You are a helpful AI assistant specialized in tech news and content creation for developers. Write simple, professional English and avoid fluff.'
              },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: maxTokens
          },
          {
            headers: {
              Authorization: `Bearer ${this.grokApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        return response.data?.choices?.[0]?.message?.content || '';
      } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        
        if (status === 403) {
          throw new Error(`xAI (Grok) API Error: No credits or insufficient permissions. Details: ${JSON.stringify(data.error || data)}`);
        }
        if (status === 400) {
          throw new Error(`xAI (Grok) API Request Error: ${data.error || 'Invalid request'}. Check if model ${this.grokModel} is correct.`);
        }
        throw error;
      }
    }

    // OpenAI-compatible for Groq, Native for Gemini
    if (this.provider === 'gemini') {
      return this.callGeminiNative(prompt, maxTokens);
    }

    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.groqApiKey,
        baseURL: this.groqBaseURL,
      });
    }

    const model = this.groqModel;
    let retries = 2;
    let delay = 2000;

    while (retries > 0) {
      try {
        const response = await this.client.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful AI assistant specialized in tech news and content creation for developers. Write simple, professional English and avoid fluff.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        });

        return response.choices?.[0]?.message?.content || '';
      } catch (error) {
        const isRetryable = error.status === 503 || error.status === 429 || error.status === 500;
        if (isRetryable && retries > 1) {
          console.warn(`[AIService] Groq error ${error.status}, retrying in ${delay}ms... (${retries - 1} left)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries--;
          delay *= 1.5;
          continue;
        }

        const pName = 'Groq';
        let errorMsg = `${pName} API Error: ${error.message}`;
        if (error.status) errorMsg += ` (Status: ${error.status})`;
        
        if (error.status === 401 || error.status === 403) {
          errorMsg = `${pName} API Authentication Error: ${error.message}. Please check your API key.`;
        } else if (error.status === 429) {
          errorMsg = `${pName} API Quota Exceeded: You are being rate limited.`;
        }

        console.error(`[AIService] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
  }

  async callGeminiNative(prompt, maxTokens = 1000) {
    const model = this.geminiModel;
    // Clean URL: ensure we don't have /openai suffix for native call
    const baseUrl = this.geminiBaseURL.replace(/\/openai\/?$/, '');
    const url = `${baseUrl}/models/${model}:generateContent?key=${this.geminiApiKey}`;

    let retries = 2;
    let delay = 2000;

    while (retries > 0) {
      try {
        const response = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.7,
            }
          },
          { timeout: 7000 }
        );

        const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!content) {
          throw new Error('Gemini returned empty response');
        }
        return content;
      } catch (error) {
        const status = error.response?.status;

        // If Quota Exceeded (429), try Smart Fallback to Groq
        if (status === 429 && this.groqApiKey) {
          console.warn(`[AIService] Gemini quota exceeded (429). Starting Smart Fallback to Groq...`);
          return await this.callGroqWithFallback(prompt, maxTokens);
        }

        const isRetryable = status === 503 || status === 429 || status === 500 || error.code === 'ECONNABORTED';

        if (isRetryable && retries > 1) {
          console.warn(`[AIService] Gemini error ${status || error.code}, retrying in ${delay}ms... (${retries - 1} left)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries--;
          delay *= 1.5;
          continue;
        }

        let errorMsg = `Gemini API Error: ${error.message}`;
        if (status) {
          const data = error.response?.data;
          errorMsg = `Gemini API Error: ${data?.error?.message || error.message} (Status: ${status})`;
        }

        console.error(`[AIService] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }
  }

  // Alias for backward compatibility
  async callGroq(prompt, maxTokens = 1000) {
    return this.callAI(prompt, maxTokens);
  }

  // Backward-compatible name used across the codebase.
  async callGrokAPI(prompt, maxTokens = 1000) {
    return this.callAI(prompt, maxTokens);
  }

  async generateBlogPost(news) {
    try {
      const topic = (news?.title || '').trim();
      const description = (news?.description || '').trim();

      const prompt = `
        You are a Senior Technical Content Strategist. Your task is to write a detailed blog post based on this news:
        News Title: "${topic}"
        News Summary: "${description}"

        CRITICAL RULES:
        1. DO NOT COPY THE SOURCE TITLE: Create a new, unique, and professional H1 title.
        2. NO COPY-PASTING: Do not use sentences from the summary. Analyze and rewrite everything in your own expert voice.
        3. WORD COUNT: Aim for 500 to 700 words. Be concise yet informative.

        STRUCTURE & DETAILS REQUIRED:
        - Introduction: Context of this news.
        - Technical Analysis: Explain the technology or move.
        - Why This Matters for Developers: Impact on tools or jobs.
        - Key Takeaways: Bullet points.
        - Conclusion: Final thoughts.

        FORMATTING:
        - Use H1 for Title.
        - Use H2 for main sections.
        - Use bold text for technical terms.
        - NO LINKS or URLs.

        TONE: Professional and informative.
        OUTPUT: Proper Markdown only.
      `;

      const content = await this.callGroq(prompt, 1200);
      const cleaned = this.sanitizeBlogPost(String(content || ''));
      if (!cleaned) {
        throw new Error('Groq returned empty blog content');
      }

      // Best-effort: take first markdown H1 as title, otherwise fallback to topic
      const firstLine = cleaned.split('\n').find((l) => l.trim().length > 0) || '';
      const title = firstLine.startsWith('# ') ? firstLine.replace(/^#\s+/, '').trim() : topic;

      // Excerpt: first ~200 chars of non-heading text
      const excerpt = cleaned
        .replace(/^#.*$/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim()
        .slice(0, 240);

      return {
        title,
        content: cleaned,
        excerpt: excerpt || description.slice(0, 240),
        tokens: 0,
      };
    } catch (error) {
      console.error('Blog generation error:', error.message || error);
      throw error;
    }
  }

  sanitizeBlogPost(text) {
    let out = String(text || '').trim();
    if (!out) return '';

    // Strip URLs (safety belt even if model ignores instructions)
    out = out.replace(/https?:\/\/\S+/gi, '');
    out = out.replace(/www\.[^\s)\]]+/gi, '');

    // Strip bare domain names (e.g. example.com, foo.bar.in)
    out = out.replace(/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\.(?:com|in|io|net|org|co|ai|dev|app|tech|news)\b/gi, '');

    // Remove common reference/aggregator lines if the model adds them
    out = out
      .split('\n')
      .filter((line) => {
        const l = line.trim().toLowerCase();
        if (!l) return true;
        if (l.startsWith('read full')) return false;
        if (l.startsWith('read more')) return false;
        if (l.startsWith('source:')) return false;
        if (l.startsWith('reference:')) return false;
        if (l.startsWith('reference url:')) return false;
        if (l.startsWith('link:')) return false;
        if (l.includes('read more at')) return false;
        return true;
      })
      .join('\n');

    // Collapse excessive blank lines
    out = out.replace(/\n{3,}/g, '\n\n').trim();

    return out;
  }

  async generateLinkedInPost(news, blogContent) {
    try {
      const prompt = `
        Create a VERY CONCISE LinkedIn post for tech professionals.
        
        News Title: ${news.title}
        News Summary: ${news.description}

        REQUIREMENTS:
        1. CATCHY HEADING: A bold first line.
        2. EXPLANATION: Explain the news in ONLY 4 to 5 lines. Be impactful.
        3. HASHTAGS: 3-5 relevant tech hashtags at the end.
        4. NO LINKS: Do not include any URLs or "Source:" lines.
        5. STYLE: Write like a professional sharing a quick update.

        Return only the text content.
      `;

      const content = await this.callGroq(prompt, 600);
      const cleaned = this.sanitizeLinkedInPost(String(content || ''));
      if (!cleaned) {
        throw new Error('Groq returned empty LinkedIn content');
      }

      return { content: cleaned, prompt };
    } catch (error) {
      console.error('LinkedIn post generation error:', error.message || error);
      throw error;
    }
  }

  sanitizeLinkedInPost(text) {
    let out = String(text || '').trim();
    if (!out) return '';

    // Strip URLs (safety belt even if model ignores instructions)
    out = out.replace(/https?:\/\/\S+/gi, '');
    out = out.replace(/www\.[^\s)\]]+/gi, '');

    // Remove common "reference" lines if the model adds them
    out = out
      .split('\n')
      .filter((line) => {
        const l = line.trim().toLowerCase();
        if (!l) return true;
        if (l.startsWith('read full')) return false;
        if (l.startsWith('read more')) return false;
        if (l.startsWith('source:')) return false;
        if (l.startsWith('reference:')) return false;
        if (l.startsWith('link:')) return false;
        return true;
      })
      .join('\n');

    // Collapse excessive blank lines
    out = out.replace(/\n{3,}/g, '\n\n').trim();

    return out;
  }

  // Compatibility wrapper used by the scheduler: returns enriched LinkedIn post
  async generateSEOFriendlyLinkedInPost(news) {
    const linked = await this.generateLinkedInPost(news, { excerpt: news.description || '' });
    const hashtags = ['#IndianTech', '#Developers', '#AI', '#Programming'];
    const seoScore = 80; // default neutral score
    const readabilityScore = 70;
    const keywords = (news.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0,6);

    return {
      content: linked.content,
      hashtags,
      seoScore,
      readabilityScore,
      keywords,
      excerpt: (linked.content || '').substring(0, 200)
    };
  }

  async generateImagePrompt(news) {
    try {
      const prompt = `
        Create a detailed image generation prompt for this tech news:
        ${news.title}
        
        The image should be professional, modern, and suitable for a tech blog.
        Return only the prompt text.
      `;

      const imagePrompt = await this.callGroq(prompt, 200);
      return imagePrompt || `Technology news: ${news.title}, professional, modern, clean design`;
    } catch (error) {
      return `Technology news: ${news.title}, professional, modern, clean design`;
    }
  }

  async summarizeNews(articles) {
    try {
      const prompt = `
        Summarize these tech news articles for Indian developers:
        ${articles.map(a => `- ${a.title}: ${a.description}`).join('\n')}
        
        Create a brief summary (2-3 sentences) of the most important news.
      `;

      const summary = await this.callGroq(prompt, 300);
      return summary || articles[0]?.description || '';
    } catch (error) {
      return articles[0]?.description || '';
    }
  }

  async callGroqWithFallback(prompt, maxTokens = 1000) {
    const fallbackModels = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b"
    ];

    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.groqApiKey,
        baseURL: this.groqBaseURL,
      });
    }

    for (const model of fallbackModels) {
      try {
        console.log(`[AIService] Trying Groq model: ${model}...`);
        const response = await this.client.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful tech assistant. Provide high-quality, professional technical content.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        });

        const content = response.choices?.[0]?.message?.content;
        if (content) {
          console.log(`[AIService] ✅ Success with Groq model: ${model}`);
          return content;
        }
      } catch (err) {
        console.warn(`[AIService] ❌ Groq model ${model} failed: ${err.message}`);
        // If it's an auth error, don't bother trying other models
        if (err.status === 401 || err.status === 403) break;
      }
    }
    throw new Error('All Gemini and Groq models failed.');
  }
}

module.exports = new AIService();
