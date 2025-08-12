import rehypeFormat from 'rehype-format';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import rehypeHighlight from 'rehype-highlight';
import remarkBreaks from 'remark-breaks';

const barebone = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

const processor = unified()
  .use(remarkParse)
  .use(remarkBreaks)
  .use(remarkDirective)
  .use(remarkFrontmatter)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeFormat)
  .use(rehypeSanitize)
  .use(rehypeHighlight)
  .use(rehypeKatex, {
    strict: false,
    trust: false,
    macros: {},
    globalGroup: true
  })
  .use(rehypeStringify);

/**
 * Convert markdown text to sanitized HTML
 */
export async function render(input: string): Promise<string> {
  if (!input) return '';
  return String(await processor.process(input));
}

/**
 * Strip HTML tags and return plain text
 */
export async function strip(input: string): Promise<string> {
  if (!input) return '';
  const html = String(await barebone.process(input));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.innerText || '';
}
