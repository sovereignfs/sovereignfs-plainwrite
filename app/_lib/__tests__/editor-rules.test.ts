import { describe, expect, it } from 'vitest';
import {
  buildContentFilePath,
  defaultFrontmatterYaml,
  defaultMarkdownTemplate,
  parseMarkdownDocument,
  renderSafeMarkdownPreview,
  serializeMarkdownDocument,
  serializeStructuredFrontmatter,
  slugifyFilename,
} from '../editor-rules';

describe('editor rules', () => {
  it('parses and serializes frontmatter without changing the markdown body', () => {
    const parsed = parseMarkdownDocument('---\ntitle: Hello\ndraft: false\n---\n\n# Hello\nBody');

    expect(parsed).toEqual({
      frontmatterYaml: 'title: Hello\ndraft: false',
      data: { title: 'Hello', draft: false },
      body: '# Hello\nBody',
    });
    expect(serializeMarkdownDocument(parsed.frontmatterYaml, parsed.body)).toBe(
      '---\ntitle: Hello\ndraft: false\n---\n\n# Hello\nBody',
    );
  });

  it('parses content with no frontmatter as empty data and unchanged body', () => {
    expect(parseMarkdownDocument('Just a plain doc.')).toEqual({
      frontmatterYaml: '',
      data: {},
      body: 'Just a plain doc.',
    });
  });

  it('falls back to the raw content (not a throw) on unparseable YAML', () => {
    // gray-matter itself throws on this — the fallback must never lose the
    // user's text, so the whole original document (frontmatter block
    // included) becomes the body rather than being discarded.
    const invalid = '---\ntitle: ["unterminated\n---\n\nBody';
    const parsed = parseMarkdownDocument(invalid);

    expect(parsed.frontmatterYaml).toBe('');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe(invalid);
  });

  it('round-trips structured field edits back into raw YAML text', () => {
    const yaml = serializeStructuredFrontmatter({
      title: 'Updated title',
      tags: ['news', 'launch'],
      published: true,
    });

    expect(parseMarkdownDocument(`---\n${yaml}\n---\n\nBody`).data).toEqual({
      title: 'Updated title',
      tags: ['news', 'launch'],
      published: true,
    });
  });

  it('preserves fields not covered by structured editing when round-tripping', () => {
    // A field the schema doesn't know about (e.g. "customKey") must survive
    // a structured-mode edit unchanged, not get silently dropped.
    const yaml = serializeStructuredFrontmatter({ title: 'Hi', customKey: 'keep-me' });

    expect(yaml).toContain('customKey: keep-me');
  });

  it('omits undefined field values instead of serializing them as null', () => {
    const yaml = serializeStructuredFrontmatter({ title: 'Hi', optional: undefined });

    expect(yaml).not.toContain('optional');
  });

  it('returns an empty string for an empty data object', () => {
    expect(serializeStructuredFrontmatter({})).toBe('');
  });

  it('produces the same result on repeated calls with identical input (gray-matter cache regression)', () => {
    // gray-matter memoizes matter(input) by content string when called with
    // no options, and the cached entry is the same object the parser
    // mutates in place — a second call with byte-identical stringified
    // frontmatter previously came back empty. Every matter()/matter.stringify
    // round-trip call site in this module must pass `{}` to opt out of that
    // cache; this test would fail immediately if one lost that `{}`.
    const first = serializeStructuredFrontmatter({ title: 'Same title' });
    const second = serializeStructuredFrontmatter({ title: 'Same title' });
    const third = serializeStructuredFrontmatter({ title: 'Same title' });

    expect(first).toBe('title: Same title');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('seeds new-file frontmatter with a writer-typed title, safely YAML-quoted', () => {
    const yaml = defaultFrontmatterYaml('src/content/blog/hello.md', 'Why: A Special Story');
    expect(yaml).toBe("title: 'Why: A Special Story'");

    // Same regression as above, exercised through the actual "New post"
    // code path (defaultMarkdownTemplate), which is called once per
    // brand-new file and would previously break on the second-or-later
    // call within a long-running server process.
    const first = defaultMarkdownTemplate('src/content/blog/hello.md', 'Why: A Special Story');
    const second = defaultMarkdownTemplate('src/content/blog/hello.md', 'Why: A Special Story');
    expect(first).toBe("---\ntitle: 'Why: A Special Story'\n---\n\nStart writing here.\n");
    expect(second).toBe(first);
  });

  it('falls back to a title derived from the filename when none is provided', () => {
    expect(defaultFrontmatterYaml('src/content/blog/hello-world.md')).toBe('title: Hello World');
  });

  it('builds collection-aware content paths with slugified filenames', () => {
    expect(buildContentFilePath('/src/content/', 'Blog Posts', 'Hello World')).toBe(
      'src/content/blog-posts/hello-world.md',
    );
    expect(buildContentFilePath('src/content', '', 'About.mdx')).toBe('src/content/about.mdx');
  });

  it('normalizes filenames to lowercase kebab-case markdown files', () => {
    expect(slugifyFilename('Launch Notes 2026')).toBe('launch-notes-2026.md');
    expect(slugifyFilename('Already Written.MDX')).toBe('already-written.mdx');
    expect(slugifyFilename('')).toBe('untitled.md');
  });

  it('escapes raw HTML and MDX-like content in previews', () => {
    const preview = renderSafeMarkdownPreview(
      '---\ntitle: Unsafe\n---\n\n# Hello\n<script>alert(1)</script>\n<Component />',
    );

    expect(preview).toContain('<h1>Hello</h1>');
    expect(preview).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(preview).toContain('&lt;Component /&gt;');
    expect(preview).not.toContain('<script>');
  });
});
