const axios = require('axios');

const searchUnsplash = async (req, res) => {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY || process.env.UNSPLASH_API_KEY;
    if (!accessKey) {
      return res.status(400).json({ message: 'Unsplash access key not configured' });
    }

    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ message: 'Missing query param: q' });

    const perPage = Math.min(parseInt(req.query.per_page || '12', 10) || 12, 30);

    const response = await axios.get('https://api.unsplash.com/search/photos', {
      params: {
        query: q,
        per_page: perPage,
        orientation: 'landscape',
        content_filter: 'high'
      },
      headers: { Authorization: `Client-ID ${accessKey}` },
      timeout: 7000
    });

    const results = Array.isArray(response.data?.results) ? response.data.results : [];

    const mapped = results.map((img) => ({
      id: img.id,
      description: img.alt_description || img.description || '',
      width: img.width,
      height: img.height,
      urls: {
        thumb: img.urls?.thumb,
        small: img.urls?.small,
        regular: img.urls?.regular,
        full: img.urls?.full
      },
      user: {
        name: img.user?.name,
        username: img.user?.username
      },
      links: {
        html: img.links?.html
      }
    }));

    res.json({ query: q, results: mapped });
  } catch (error) {
    const status = error.response?.status;
    const msg = status ? `Unsplash error (${status})` : 'Unsplash error';
    res.status(500).json({ message: msg, error: error.response?.data || error.message });
  }
};

module.exports = {
  searchUnsplash
};
