import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

// Configure marked to use highlight.js for code highlighting
marked.use(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

// Configure marked for safe HTML output
marked.setOptions({
  breaks: true,
  gfm: true
});

// Custom renderer to handle links safely
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  // Make external links open in new tab and add security attributes
  const isExternal = href && (href.startsWith('http://') || href.startsWith('https://'));
  const target = isExternal ? ' target="_blank"' : '';
  const rel = isExternal ? ' rel="noopener noreferrer"' : '';
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}"${target}${rel}${titleAttr}>${text}</a>`;
};

marked.use({ renderer });

/**
 * Convert markdown text to sanitized HTML
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown) return '';

  const html = await marked(markdown);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'u',
      's',
      'code',
      'pre',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'img',
      'span'
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'src', 'alt', 'width', 'height', 'class'],
    ALLOW_DATA_ATTR: false
  });
}

/**
 * Strip HTML tags and return plain text
 */
export async function stripMarkdown(markdown: string): Promise<string> {
  const html = await renderMarkdown(markdown);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}
