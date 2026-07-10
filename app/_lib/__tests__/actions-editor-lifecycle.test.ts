import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), get: vi.fn() },
    connections: { disconnect: vi.fn() },
  },
}));

const getFileContent = vi.fn(async () => ({ content: '---\ntitle: Remote\n---\n\nRemote body.', sha: 'remote-sha-1' }));

vi.mock('../git-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git-providers')>();
  return {
    ...actual,
    getGitProvider: vi.fn(() => ({ getFileContent })),
  };
});

let membershipRow: { role: string } | null = { role: 'editor' };
let projectRow: Record<string, unknown> | null = null;
// The one draft row this test's (project, path, user) tuple can have —
// mutated in place by insert/update/delete, matching the real upsertDraft/
// discardDraft/getEditorState query shapes for a single-file lifecycle.
let draftRow: Record<string, unknown> | null = null;
let collectionSchemaRow: Record<string, unknown> | null = null;

const fakeDb = {
  select() {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where() {
            return this;
          },
          orderBy() {
            return this;
          },
          limit: async () => {
            if (tableName === 'plainwrite_project_members') return membershipRow ? [membershipRow] : [];
            if (tableName === 'plainwrite_projects') return projectRow ? [projectRow] : [];
            if (tableName === 'plainwrite_drafts') return draftRow ? [draftRow] : [];
            if (tableName === 'plainwrite_file_cache') return [];
            if (tableName === 'plainwrite_collection_schemas') {
              return collectionSchemaRow ? [collectionSchemaRow] : [];
            }
            if (tableName === 'plainwrite_credentials') return [];
            return [];
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Record<string, unknown>) => {
        if (tableName === 'plainwrite_drafts') draftRow = row;
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (tableName === 'plainwrite_drafts' && draftRow) {
            draftRow = { ...draftRow, ...patch };
          }
        },
      }),
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async () => {
        if (tableName === 'plainwrite_drafts') draftRow = null;
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  membershipRow = { role: 'editor' };
  draftRow = null;
  collectionSchemaRow = null;
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
  getFileContent.mockResolvedValue({
    content: '---\ntitle: Remote\n---\n\nRemote body.',
    sha: 'remote-sha-1',
  });
});

const PATH = 'src/content/hello.md';

function buildFormData(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

describe('editor lifecycle — open, save, commit, discard, reopen', () => {
  it('opens provider content when no draft exists', async () => {
    const { getEditorState } = await import('../actions');

    const state = await getEditorState('project-1', PATH);

    expect(state.status).toBe('unmodified');
    expect(state.content).toBe('---\ntitle: Remote\n---\n\nRemote body.');
    expect(state.baseSha).toBe('remote-sha-1');
    expect(state.loadError).toBeNull();
  });

  it('saving a draft makes the editor reopen the draft instead of provider content', async () => {
    const { getEditorState, saveDraft } = await import('../actions');

    await saveDraft('project-1', PATH, buildFormData({
      baseSha: 'remote-sha-1',
      content: '---\ntitle: Edited locally\n---\n\nEdited body.',
    }));

    expect(getFileContent).not.toHaveBeenCalled();
    const reopened = await getEditorState('project-1', PATH);
    expect(reopened.status).toBe('draft');
    expect(reopened.content).toBe('---\ntitle: Edited locally\n---\n\nEdited body.');
  });

  it('committing updates the draft status without losing content, then discard reverts to provider content', async () => {
    const { commitDraft, discardDraft, getEditorState, saveDraft } = await import('../actions');

    await saveDraft('project-1', PATH, buildFormData({
      baseSha: 'remote-sha-1',
      content: '---\ntitle: Ready\n---\n\nReady body.',
    }));
    await commitDraft(
      'project-1',
      PATH,
      buildFormData({
        baseSha: 'remote-sha-1',
        content: '---\ntitle: Ready\n---\n\nReady body.',
        commitMessage: 'Ready for review',
      }),
    );

    const committed = await getEditorState('project-1', PATH);
    expect(committed.status).toBe('committed');
    expect(committed.commitMessage).toBe('Ready for review');
    expect(committed.content).toBe('---\ntitle: Ready\n---\n\nReady body.');

    await discardDraft('project-1', PATH);

    expect(draftRow).toBeNull();
    const afterDiscard = await getEditorState('project-1', PATH);
    expect(afterDiscard.status).toBe('unmodified');
    expect(afterDiscard.content).toBe('---\ntitle: Remote\n---\n\nRemote body.');
    expect(getFileContent).toHaveBeenCalledOnce(); // only called once — after discard clears the draft
  });

  it('ignores a published draft on reopen and fetches fresh provider content', async () => {
    const { getEditorState, saveDraft } = await import('../actions');

    await saveDraft('project-1', PATH, buildFormData({
      baseSha: 'remote-sha-1',
      content: '---\ntitle: Old draft\n---\n\nOld body.',
    }));
    // Simulate a completed publish: the draft row is marked published but
    // not deleted (matches publishCommittedDraft's real behavior).
    draftRow = { ...draftRow, status: 'published', publishedAt: 123 };

    const state = await getEditorState('project-1', PATH);

    expect(state.status).toBe('unmodified');
    expect(state.content).toBe('---\ntitle: Remote\n---\n\nRemote body.');
    expect(getFileContent).toHaveBeenCalledOnce();
  });
});

describe('editor state — new post title seeding', () => {
  it('seeds a brand-new file\'s frontmatter with the title from the "New post" dialog', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValueOnce(new GitProviderError('Not found', 404));
    const { getEditorState } = await import('../actions');

    const state = await getEditorState('project-1', PATH, 'Why: A Special Story');

    expect(state.status).toBe('unmodified');
    expect(state.loadError).toBeNull();
    expect(state.content).toBe(
      "---\ntitle: 'Why: A Special Story'\n---\n\nStart writing here.\n",
    );
  });

  it('falls back to a slug-derived title when no title is given for a new file', async () => {
    const { GitProviderError } = await import('../git-providers');
    getFileContent.mockRejectedValueOnce(new GitProviderError('Not found', 404));
    const { getEditorState } = await import('../actions');

    const state = await getEditorState('project-1', PATH);

    expect(state.content).toBe('---\ntitle: Hello\n---\n\nStart writing here.\n');
  });
});

describe('editor state — collection schema fields', () => {
  it('returns no schema fields when the collection has no schema defined', async () => {
    const { getEditorState } = await import('../actions');

    const state = await getEditorState('project-1', PATH);

    expect(state.schemaFields).toEqual([]);
  });

  it('returns the collection schema fields for the file\'s inferred collection', async () => {
    collectionSchemaRow = {
      id: 'schema-1',
      tenantId: 'tenant-1',
      projectId: 'project-1',
      collection: 'Root',
      schemaJson: JSON.stringify([
        { name: 'title', type: 'string', required: true },
        { name: 'published', type: 'boolean', required: false },
      ]),
      updatedBy: null,
      inferredAt: 1,
      updatedAt: 1,
    };
    const { getEditorState } = await import('../actions');

    const state = await getEditorState('project-1', PATH);

    expect(state.schemaFields).toEqual([
      { name: 'title', type: 'string', required: true },
      { name: 'published', type: 'boolean', required: false },
    ]);
  });
});
