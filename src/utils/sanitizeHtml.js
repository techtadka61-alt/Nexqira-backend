const sanitizeHtml = require('sanitize-html');

// Matches the tags/marks produced by the Tiptap editor in Admin-panel
// (StarterKit + Underline + Link + Image + TextAlign).
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3',
  'ul', 'ol', 'li',
  'blockquote',
  'a', 'img',
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['style'],
};

const ALLOWED_STYLES = {
  '*': {
    'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
  },
};

function sanitizePostContent(html) {
  if (typeof html !== 'string') return html;

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
}

module.exports = { sanitizePostContent };
