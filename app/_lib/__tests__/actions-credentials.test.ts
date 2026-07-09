import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const secretsCreate = vi.fn();
const secretsUpdate = vi.fn();
const secretsDelete = vi.fn();
const secretsGet = vi.fn();
const connectionsDisconnect = vi.fn();

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    auth: { requireSession: vi.fn(async () => ({ user: { id: 'user-1', tenantId: 'tenant-1' } })) },
    db: { getClient: vi.fn(async () => fakeDb) },
    secrets: {
      create: secretsCreate,
      update: secretsUpdate,
      delete: secretsDelete,
      get: secretsGet,
    },
    connections: { disconnect: connectionsDisconnect },
  },
}));

vi.mock('../git-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git-providers')>();
  return {
    ...actual,
    getGitProvider: vi.fn(() => ({
      validatePat: vi.fn(async () => ({ login: 'octocat', canPush: true })),
    })),
  };
});

let membershipRow: { role: string } | null = { role: 'editor' };
let projectRow: Record<string, unknown> | null = null;
let credentialRow: Record<string, unknown> | null = null;
const insertedCredentials: Array<Record<string, unknown>> = [];
const updatedCredentials: Array<Record<string, unknown>> = [];

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
            if (tableName === 'plainwrite_credentials') return credentialRow ? [credentialRow] : [];
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
        if (tableName === 'plainwrite_credentials') {
          insertedCredentials.push(row);
          credentialRow = row;
        }
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (row: Record<string, unknown>) => ({
        where: async () => {
          if (tableName === 'plainwrite_credentials') {
            updatedCredentials.push(row);
            credentialRow = { ...credentialRow, ...row };
          }
        },
      }),
    };
  },
};

describe('connectGitHubPat — credential storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedCredentials.length = 0;
    updatedCredentials.length = 0;
    membershipRow = { role: 'editor' };
    credentialRow = null;
    projectRow = {
      id: 'project-1',
      tenantId: 'tenant-1',
      repoOwner: 'octo',
      repoName: 'docs',
      provider: 'github',
      branch: 'main',
      pathPrefix: 'src/content',
    };
    secretsCreate.mockResolvedValue({ id: 'secret-new' });
  });

  it('never writes the raw token into plainwrite_credentials — only secret_ref', async () => {
    const { connectGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_super_secret_value');

    await connectGitHubPat('project-1', formData);

    expect(insertedCredentials).toHaveLength(1);
    const row = insertedCredentials.at(0);
    expect(row?.secretRef).toBe('secret-new');
    expect(JSON.stringify(row)).not.toContain('ghp_super_secret_value');
    expect(Object.keys(row ?? {})).not.toContain('token');
  });

  it('reconnecting from needs_reauth rotates the existing vault secret instead of orphaning it', async () => {
    credentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      userId: 'user-1',
      provider: 'github',
      authType: 'pat',
      connectionId: null,
      secretRef: 'secret-old',
      tokenExpiresAt: null,
      providerLogin: 'octocat',
      status: 'needs_reauth',
      lastError: 'Credential secret could not be read.',
      createdAt: 1,
      updatedAt: 1,
    };
    secretsUpdate.mockResolvedValue(undefined);

    const { connectGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_rotated_value');

    await connectGitHubPat('project-1', formData);

    expect(secretsCreate).not.toHaveBeenCalled();
    expect(secretsUpdate).toHaveBeenCalledWith('secret-old', 'ghp_rotated_value');
    expect(updatedCredentials).toHaveLength(1);
    const row = updatedCredentials.at(0);
    expect(row?.secretRef).toBe('secret-old');
    expect(row?.status).toBe('connected');
    expect(JSON.stringify(row)).not.toContain('ghp_rotated_value');
    expect(Object.keys(row ?? {})).not.toContain('token');
  });

  it('does not reuse an OAuth-owned secretRef when reconnecting with a PAT', async () => {
    credentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      userId: 'user-1',
      provider: 'github',
      authType: 'oauth',
      connectionId: 'connection-1',
      secretRef: 'secret-oauth',
      tokenExpiresAt: null,
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const { connectGitHubPat } = await import('../actions');
    const formData = new FormData();
    formData.set('token', 'ghp_new_pat_value');

    await connectGitHubPat('project-1', formData);

    expect(secretsUpdate).not.toHaveBeenCalled();
    expect(secretsCreate).toHaveBeenCalledOnce();
    expect(updatedCredentials[0]?.secretRef).toBe('secret-new');
  });
});

describe('disconnectGitHubCredential — tolerates a missing vault entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedCredentials.length = 0;
    updatedCredentials.length = 0;
    membershipRow = { role: 'editor' };
  });

  it('still marks the credential disconnected when the vault secret is already gone', async () => {
    credentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      userId: 'user-1',
      provider: 'github',
      authType: 'pat',
      connectionId: null,
      secretRef: 'secret-already-revoked',
      tokenExpiresAt: null,
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    secretsDelete.mockRejectedValue(new Error('secret not found'));

    const { disconnectGitHubCredential } = await import('../actions');

    await expect(disconnectGitHubCredential('project-1')).resolves.toBeUndefined();
    expect(updatedCredentials).toHaveLength(1);
    expect(updatedCredentials[0]?.status).toBe('disconnected');
  });

  it('still marks the credential disconnected when the OAuth connection disconnect call fails', async () => {
    credentialRow = {
      tenantId: 'tenant-1',
      projectId: 'project-1',
      userId: 'user-1',
      provider: 'github',
      authType: 'oauth',
      connectionId: 'connection-1',
      secretRef: 'secret-oauth',
      tokenExpiresAt: null,
      providerLogin: 'octocat',
      status: 'connected',
      lastError: null,
      createdAt: 1,
      updatedAt: 1,
    };
    connectionsDisconnect.mockRejectedValue(new Error('connection already removed'));

    const { disconnectGitHubCredential } = await import('../actions');

    await expect(disconnectGitHubCredential('project-1')).resolves.toBeUndefined();
    expect(updatedCredentials).toHaveLength(1);
    expect(updatedCredentials[0]?.status).toBe('disconnected');
  });
});
