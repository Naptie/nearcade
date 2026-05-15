import rehypeFormat from 'rehype-format';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
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

const isWhitespace = (char: string | undefined): boolean => !!char && /\s/.test(char);

const isEscaped = (input: string, index: number): boolean => {
  let slashCount = 0;

  for (let i = index - 1; i >= 0 && input[i] === '\\'; i--) {
    slashCount++;
  }

  return slashCount % 2 === 1;
};

const countRun = (input: string, index: number, marker: string): number => {
  let count = 0;

  while (input[index + count] === marker) {
    count++;
  }

  return count;
};

const findClosingBacktickRun = (input: string, index: number, size: number): number => {
  const marker = '`'.repeat(size);
  return input.indexOf(marker, index + size);
};

const lineFence = (line: string): { marker: '`' | '~'; size: number } | undefined => {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  if (!match) return undefined;

  const sequence = match[1];
  return { marker: sequence[0] as '`' | '~', size: sequence.length };
};

/**
 * Escape single dollar signs unless they are surrounded by whitespace.
 *
 * `remark-math` treats every unescaped single `$` as a possible inline math
 * delimiter. Requiring whitespace on both sides keeps `$5`-style prices as
 * text while still allowing spaced inline math such as ` $ x + y $ `.
 */
const escapeNonSpacedDollarDelimiters = (input: string): string => {
  let output = '';
  let index = 0;
  let fence: { marker: '`' | '~'; size: number } | undefined;

  while (index < input.length) {
    const lineEnd = input.indexOf('\n', index);
    const nextLineIndex = lineEnd === -1 ? input.length : lineEnd + 1;
    const line = input.slice(index, nextLineIndex);
    const lineContent = line.endsWith('\n') ? line.slice(0, -1) : line;
    const currentFence = lineFence(lineContent);

    if (fence) {
      output += line;

      if (currentFence?.marker === fence.marker && currentFence.size >= fence.size) {
        fence = undefined;
      }

      index = nextLineIndex;
      continue;
    }

    if (currentFence) {
      fence = currentFence;
      output += line;
      index = nextLineIndex;
      continue;
    }

    let offset = 0;

    while (offset < line.length) {
      const absoluteIndex = index + offset;
      const char = line[offset];

      if (char === '`') {
        const size = countRun(line, offset, '`');
        const closingIndex = findClosingBacktickRun(line, offset, size);

        if (closingIndex !== -1) {
          const end = closingIndex + size;
          output += line.slice(offset, end);
          offset = end;
          continue;
        }
      }

      if (char === '$' && !isEscaped(input, absoluteIndex)) {
        const size = countRun(line, offset, '$');

        if (size > 1) {
          output += line.slice(offset, offset + size);
          offset += size;
          continue;
        }

        if (
          size === 1 &&
          !(isWhitespace(input[absoluteIndex - 1]) && isWhitespace(input[absoluteIndex + 1]))
        ) {
          output += '\\$';
          offset++;
          continue;
        }
      }

      output += char;
      offset++;
    }

    index = nextLineIndex;
  }

  return output;
};

/**
 * Convert markdown text to sanitized HTML
 */
export const render = async (input: string): Promise<string> => {
  if (!input) return '';
  return String(await processor.process(escapeNonSpacedDollarDelimiters(input)));
};

/**
 * Strip HTML tags and return plain text
 */
export const strip = async (input: string): Promise<string> => {
  if (!input) return '';
  const html = String(await barebone.process(escapeNonSpacedDollarDelimiters(input)));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.innerText || '';
};
