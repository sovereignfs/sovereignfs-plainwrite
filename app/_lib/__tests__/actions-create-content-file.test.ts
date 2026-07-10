import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn() },
    connections: { disconnect: vi.fn() },
  },
}));

let membershipRow: { role: string } | null = { role: 'editor' };
let projectRow: Record<string, unknown> | null = null;

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where() {
            return this;
          },
          limit: async () => {
            if (tableName === 'plainwrite_project_members') return membershipRow ? [membershipRow] : [];
            if (tableName === 'plainwrite_projects') return projectRow ? [projectRow] : [];
            return [];
          },
        };
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  membershipRow = { role: 'editor' };
  projectRow = {
    id: 'project-1',
    tenantId: 'tenant-1',
    repoOwner: 'octo',
    repoName: 'docs',
    provider: 'github',
    branch: 'main',
    pathPrefix: 'src/content',
    ssgType: 'astro',
    isPrivate: false,
  };
});

describe('createContentFile — title-first new post dialog', () => {
  it('redirects to the editor with the slugified filename and the title carried as a query param', async () => {
    const { createContentFile } = await import('../actions');
    const formData = new FormData();
    formData.set('title', 'Why: A Special Story');
    formData.set('collection', 'blog');
    formData.set('filename', 'why-a-special-story.md');

    await expect(createContentFile('project-1', formData)).rejects.toThrow(
      'REDIRECT:/plainwrite/project-1/editor/src/content/blog/why-a-special-story.md?title=Why%3A%20A%20Special%20Story',
    );
  });

  it('omits the title query param when no title was submitted', async () => {
    const { createContentFile } = await import('../actions');
    const formData = new FormData();
    formData.set('collection', 'blog');
    formData.set('filename', 'manual-file.md');

    await expect(createContentFile('project-1', formData)).rejects.toThrow(
      'REDIRECT:/plainwrite/project-1/editor/src/content/blog/manual-file.md',
    );
  });

  it('still requires a filename even when a title is present', async () => {
    const { createContentFile } = await import('../actions');
    const formData = new FormData();
    formData.set('title', 'Untitled post');

    await expect(createContentFile('project-1', formData)).rejects.toThrow('Filename is required.');
  });
});
