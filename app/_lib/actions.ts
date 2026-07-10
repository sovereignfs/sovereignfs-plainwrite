'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sdk } from '@sovereignfs/sdk';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  plainwriteCollectionSchemas,
  plainwriteCredentials,
  plainwriteDrafts,
  plainwriteFileCache,
  plainwriteProjectMembers,
  plainwriteProjects,
  plainwritePublishEvents,
  type PlainwriteCollectionSchema,
  type PlainwriteCredential,
  type PlainwriteDraft,
  type PlainwriteFileCacheEntry,
  type PlainwriteProject,
  type PlainwriteProjectMember,
} from '../_db/schema';
import { defaultMarkdownTemplate, type ContentFile } from './content-rules';
import { buildContentFilePath } from './editor-rules';
import { getGitProvider, GitProviderError, type GitPublishResult } from './git-providers';
import { buildGitHubOAuthUrl, exchangeGitHubOAuthCode } from './oauth-rules';
import { notifyUser, recordActivity } from './platform-events';
import {
  assertProjectRole,
  isProjectRole,
  parseGitHubRepositoryUrl,
  projectInputDefaults,
  type ProjectRole,
} from './project-rules';
import {
  inferCollectionSchema,
  parseSchemaJson,
  schemaFieldsFromForm,
  serializeSchemaFields,
  type CollectionSchemaField,
} from './schema-rules';
import { getSsgAdapter } from './ssg-adapters';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;
const CONTENT_SYNC_TTL_SECONDS = 300;

interface ProjectSummary extends PlainwriteProject {
  currentUserRole: ProjectRole;
}

export interface ProjectListItem extends ProjectSummary {
  /** Posts with a local, not-yet-ready draft for the current user. */
  writingCount: number;
  /** Posts marked ready to publish for the current user. */
  readyCount: number;
  /** Approximate count of posts already on the site (last synced file-cache size). */
  liveCount: number;
  /** True when the current user's publishing credential needs reconnecting. */
  needsAttention: boolean;
}

interface ProjectMemberSummary extends PlainwriteProjectMember {
  displayName: string | null;
  email: string | null;
}

interface CredentialSummary {
  provider: string;
  authType: string;
  connectionId: string | null;
  providerLogin: string | null;
  status: string;
  lastError: string | null;
  tokenExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ProjectDetail extends ProjectSummary {
  members: ProjectMemberSummary[];
  credential: CredentialSummary | null;
  /**
   * Set when the platform directory lookup for member display names/emails
   * failed — `members` still has real `userId`s but `displayName`/`email`
   * fall back to `null` for all of them. Without this flag that degradation
   * is silent and looks identical to "this instance just doesn't have
   * profile data," not "something failed."
   */
  directoryLookupFailed: boolean;
}

interface GitHubOAuthStatus {
  configured: boolean;
  source: string;
  missingRequired: readonly string[];
}

interface CollectionSchemaSummary {
  id: string;
  collection: string;
  fields: CollectionSchemaField[];
  inferredAt: number | null;
  updatedAt: number;
  isManual: boolean;
}

interface ContentFileSummary extends ContentFile {
  status: 'unmodified' | 'draft' | 'committed' | 'pending-delete' | 'conflict';
  lastSyncedAt: number;
}

interface ContentFileListResult {
  files: ContentFileSummary[];
  /**
   * Set when the automatic TTL-triggered background refresh failed —
   * `files` still reflects the last successful sync, not a live failure, so
   * callers should show this rather than silently rendering possibly-stale
   * data with no indication anything went wrong.
   */
  syncError: string | null;
}

interface EditorState {
  project: Pick<PlainwriteProject, 'id' | 'name' | 'repoOwner' | 'repoName' | 'branch' | 'pathPrefix'>;
  path: string;
  content: string;
  baseSha: string | null;
  status: 'unmodified' | 'draft' | 'committed';
  commitMessage: string | null;
  currentUserRole: ProjectRole;
  /**
   * Set when the remote file couldn't be loaded and the failure was NOT a
   * definitive "file does not exist". Callers must render a retry state and
   * must never let the editor open for save/commit/publish in this case —
   * otherwise a transient GitHub failure (rate limit, outage, expired token)
   * looks identical to "new file" and a save+publish overwrites the real
   * remote file with placeholder content.
   */
  loadError: string | null;
  /**
   * The collection schema fields for this file's inferred collection, if
   * any have been defined (inferred or manual). Empty array means "no
   * schema" — the editor falls back to raw-YAML-only editing.
   */
  schemaFields: CollectionSchemaField[];
}

interface PublishEventSummary {
  id: string;
  message: string;
  files: string[];
  status: string;
  commitSha: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: number;
}

interface ProjectContext {
  db: Db;
  userId: string;
  tenantId: string;
}

/**
 * Result shape for form actions driven by `useActionState` on the client
 * (sync, publish, invite). These surface expected failures — bad branch, no
 * connected credential, a real publish conflict, an unresolvable invite —
 * as inline UI state instead of a thrown Error, which would otherwise
 * propagate through the form's action transition to the nearest error
 * boundary and replace the whole page. Actions that are only reachable
 * through UI already gated by role/authorization checks (e.g.
 * `requireProjectRole` failures from a tampered request) still throw —
 * those aren't user-recoverable inline and the plugin's `error.tsx`
 * boundary is the right place for them.
 */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function now() {
  return Math.floor(Date.now() / 1000);
}

async function getContext(): Promise<ProjectContext> {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

function formString(formData: FormData, key: string, fallback = '') {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : fallback;
}

function formRawString(formData: FormData, key: string, fallback = '') {
  const value = formData.get(key);
  return typeof value === 'string' ? value : fallback;
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === 'on';
}

async function getMembership(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<ProjectRole | null> {
  const rows = await db
    .select({ role: plainwriteProjectMembers.role })
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
        eq(plainwriteProjectMembers.userId, userId),
      ),
    )
    .limit(1);
  const role = rows[0]?.role;
  return role && isProjectRole(role) ? role : null;
}

async function requireProjectRole(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
  requiredRole: ProjectRole,
): Promise<ProjectRole> {
  const role = await getMembership(db, tenantId, projectId, userId);
  assertProjectRole(role, requiredRole);
  return role;
}

/**
 * Confirms `path` is a content file this project's file listing would ever
 * show — inside `pathPrefix`, using an extension the SSG adapter recognizes,
 * with no `..`/absolute-path traversal. Without this, an editor-role member
 * could read, draft, or publish arbitrary repo paths (e.g. `.github/workflows/x.yml`)
 * through Plainwrite even though the UI only ever lists `pathPrefix`-scoped
 * content — defeating the project's own scoping model and audit trail.
 */
function assertContentPathAllowed(project: PlainwriteProject, path: string) {
  const segments = path.split('/');
  const hasTraversal = segments.some(
    (segment) => segment === '' || segment === '.' || segment === '..',
  );
  if (!path || path.startsWith('/') || path.includes('\\') || hasTraversal) {
    throw new Error('Invalid file path.');
  }

  const adapter = getSsgAdapter(project.ssgType);
  if (!adapter.isPathAllowed(path, project.pathPrefix)) {
    throw new Error("File path is outside this project's configured content path.");
  }
}

export async function listProjects(
  options: { includeArchived?: boolean } = {},
): Promise<ProjectListItem[]> {
  const { db, userId, tenantId } = await getContext();
  const memberships = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.userId, userId),
      ),
    );

  const projectIds = memberships.map((membership) => membership.projectId);
  if (projectIds.length === 0) return [];

  const conditions = [
    eq(plainwriteProjects.tenantId, tenantId),
    inArray(plainwriteProjects.id, projectIds),
  ];
  if (!options.includeArchived) conditions.push(isNull(plainwriteProjects.archivedAt));

  const projects = await db
    .select()
    .from(plainwriteProjects)
    .where(and(...conditions))
    .orderBy(asc(plainwriteProjects.name));

  const roleByProjectId = new Map(
    memberships
      .filter((membership) => isProjectRole(membership.role))
      .map((membership) => [membership.projectId, membership.role as ProjectRole]),
  );

  // Three batched queries (not per-project) so the site list stays a fixed
  // number of round trips regardless of how many projects the user belongs
  // to — feeds the "N writing · N ready · N live" summary on each site card.
  const [draftRows, credentialRows, fileCacheRows] = await Promise.all([
    db
      .select()
      .from(plainwriteDrafts)
      .where(
        and(
          eq(plainwriteDrafts.tenantId, tenantId),
          eq(plainwriteDrafts.userId, userId),
          inArray(plainwriteDrafts.projectId, projectIds),
          isNotNull(plainwriteDrafts.content),
        ),
      ),
    db
      .select()
      .from(plainwriteCredentials)
      .where(
        and(
          eq(plainwriteCredentials.tenantId, tenantId),
          eq(plainwriteCredentials.userId, userId),
          inArray(plainwriteCredentials.projectId, projectIds),
        ),
      ),
    db
      .select({ projectId: plainwriteFileCache.projectId })
      .from(plainwriteFileCache)
      .where(
        and(
          eq(plainwriteFileCache.tenantId, tenantId),
          inArray(plainwriteFileCache.projectId, projectIds),
        ),
      ),
  ]);

  const writingByProject = new Map<string, number>();
  const readyByProject = new Map<string, number>();
  for (const draft of draftRows) {
    const counts = draft.status === 'draft' ? writingByProject : readyByProject;
    if (draft.status === 'draft' || draft.status === 'committed') {
      counts.set(draft.projectId, (counts.get(draft.projectId) ?? 0) + 1);
    }
  }
  const liveByProject = new Map<string, number>();
  for (const row of fileCacheRows) {
    liveByProject.set(row.projectId, (liveByProject.get(row.projectId) ?? 0) + 1);
  }
  const attentionProjectIds = new Set(
    credentialRows.filter((row) => row.status === 'needs_reauth').map((row) => row.projectId),
  );

  return projects.flatMap((project): ProjectListItem[] => {
    const currentUserRole = roleByProjectId.get(project.id);
    if (!currentUserRole) return [];
    return [
      {
        ...project,
        currentUserRole,
        writingCount: writingByProject.get(project.id) ?? 0,
        readyCount: readyByProject.get(project.id) ?? 0,
        liveCount: liveByProject.get(project.id) ?? 0,
        needsAttention: attentionProjectIds.has(project.id),
      },
    ];
  });
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  const { db, userId, tenantId } = await getContext();
  const currentUserRole = await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const rows = await db
    .select()
    .from(plainwriteProjects)
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)))
    .limit(1);
  const project = rows[0];
  if (!project) throw new Error('Project not found');

  const memberRows = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
      ),
    )
    .orderBy(asc(plainwriteProjectMembers.joinedAt));

  let directoryRows: Awaited<ReturnType<typeof sdk.directory.resolveUsers>> = [];
  let directoryLookupFailed = false;
  try {
    directoryRows = await sdk.directory.resolveUsers({
      ids: memberRows.map((member) => member.userId),
    });
  } catch {
    directoryRows = [];
    directoryLookupFailed = true;
  }
  const userById = new Map(directoryRows.map((user) => [user.id, user]));
  const credential = await getCredentialRow(db, tenantId, projectId, userId);

  return {
    ...project,
    credential: credential
      ? {
          provider: credential.provider,
          authType: credential.authType,
          connectionId: credential.connectionId,
          providerLogin: credential.providerLogin,
          status: credential.status,
          lastError: credential.lastError,
          tokenExpiresAt: credential.tokenExpiresAt,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        }
      : null,
    currentUserRole,
    directoryLookupFailed,
    members: memberRows.map((member) => {
      const user = userById.get(member.userId);
      return {
        ...member,
        displayName: user?.name ?? null,
        email: user?.email ?? null,
      };
    }),
  };
}

export async function getGitHubOAuthStatus(projectId: string): Promise<GitHubOAuthStatus> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  try {
    const config = await sdk.connections.getProviderConfig('git.github');
    return {
      configured: config.configured,
      source: config.source,
      missingRequired: config.missingRequired,
    };
  } catch {
    return {
      configured: false,
      source: 'missing',
      missingRequired: ['provider config'],
    };
  }
}

export async function getProjectNavigation(projectId: string) {
  const project = await getProject(projectId);
  return {
    id: project.id,
    name: project.name,
    repoOwner: project.repoOwner,
    repoName: project.repoName,
    archivedAt: project.archivedAt,
    currentUserRole: project.currentUserRole,
  };
}

export async function listPublishEvents(projectId: string): Promise<PublishEventSummary[]> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const rows = await db
    .select()
    .from(plainwritePublishEvents)
    .where(
      and(
        eq(plainwritePublishEvents.tenantId, tenantId),
        eq(plainwritePublishEvents.projectId, projectId),
      ),
    )
    .orderBy(desc(plainwritePublishEvents.createdAt))
    .limit(8);

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    files: parsePublishedFiles(row.files),
    status: row.status,
    commitSha: row.commitSha,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt,
  }));
}

export async function listCollectionSchemas(projectId: string): Promise<CollectionSchemaSummary[]> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const rows = await db
    .select()
    .from(plainwriteCollectionSchemas)
    .where(
      and(
        eq(plainwriteCollectionSchemas.tenantId, tenantId),
        eq(plainwriteCollectionSchemas.projectId, projectId),
      ),
    )
    .orderBy(asc(plainwriteCollectionSchemas.collection));

  return rows.map((row) => ({
    id: row.id,
    collection: row.collection,
    fields: safeParseSchema(row),
    inferredAt: row.inferredAt,
    updatedAt: row.updatedAt,
    isManual: row.updatedBy !== null,
  }));
}

/**
 * Synthesizes a ContentFileSummary for a draft that has no corresponding
 * `plainwriteFileCache` row — either because the whole file tree can't be
 * synced (no credential on a private repo) or because the draft is a
 * brand-new file created locally that was never published, so it can never
 * appear in a GitHub-tree sync until it is. Without this, "New content
 * file" + "Save draft" produces a draft the user can never find again on
 * the dashboard.
 */
function draftToLocalOnlyFileSummary(
  draft: PlainwriteDraft,
  adapter: ReturnType<typeof getSsgAdapter>,
  project: PlainwriteProject,
): ContentFileSummary {
  return {
    path: draft.filePath,
    collection: adapter.inferCollection(draft.filePath, project.pathPrefix),
    filename: draft.filePath.split('/').at(-1) ?? draft.filePath,
    sha: draft.baseSha ?? '',
    lastSyncedAt: draft.updatedAt,
    status: normalizeDraftStatus(draft.status),
  };
}

export async function listContentFiles(projectId: string): Promise<ContentFileListResult> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const project = await getProjectRow(db, tenantId, projectId);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  if (!canViewCachedMetadata(project, credential.token)) {
    // Repo metadata (the synced file tree) isn't visible without a
    // credential, but the user's own drafts never touched GitHub to be
    // created — they're local DB rows. Surface those so "Save draft" work
    // isn't invisible just because the file-tree listing is gated.
    const drafts = await db
      .select()
      .from(plainwriteDrafts)
      .where(
        and(
          eq(plainwriteDrafts.tenantId, tenantId),
          eq(plainwriteDrafts.projectId, projectId),
          eq(plainwriteDrafts.userId, userId),
          isNotNull(plainwriteDrafts.content),
        ),
      );
    const adapter = getSsgAdapter(project.ssgType);
    return {
      files: drafts.map((draft) => draftToLocalOnlyFileSummary(draft, adapter, project)),
      syncError:
        'Connect a GitHub token to see the full repository file list. Showing your local drafts only.',
    };
  }

  let files = await db
    .select()
    .from(plainwriteFileCache)
    .where(
      and(eq(plainwriteFileCache.tenantId, tenantId), eq(plainwriteFileCache.projectId, projectId)),
    )
    .orderBy(asc(plainwriteFileCache.collection), asc(plainwriteFileCache.path));

  let syncError: string | null = null;
  if (shouldRefreshContentCache(files.map((file) => file.lastSyncedAt))) {
    try {
      if (!project.isPrivate || credential.token) {
        await refreshProjectContentCache(db, tenantId, project, credential.token);
        files = await db
          .select()
          .from(plainwriteFileCache)
          .where(
            and(
              eq(plainwriteFileCache.tenantId, tenantId),
              eq(plainwriteFileCache.projectId, projectId),
            ),
          )
          .orderBy(asc(plainwriteFileCache.collection), asc(plainwriteFileCache.path));
      }
    } catch {
      // Automatic refresh should not block opening a project dashboard —
      // but the failure must still be visible somewhere rather than
      // silently rendering the last-synced cache with no indication.
      syncError = 'Automatic content sync failed. Showing the last successfully synced files.';
    }
  }

  const drafts = await db
    .select()
    .from(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.userId, userId),
      ),
    );

  const draftByPath = new Map(drafts.map((draft) => [draft.filePath, draft]));
  const cachedPaths = new Set(files.map((file) => file.path));
  // A draft for a file that was never synced from GitHub (created locally
  // via "New content file" and not yet published) has no file-cache row —
  // without this, it would never appear here at all, on any project,
  // regardless of credentials. Pending-deletes never apply here: staging a
  // deletion requires an existing baseSha, which only exists for files
  // that were already synced.
  const localOnlyDrafts = drafts.filter(
    (draft) => !cachedPaths.has(draft.filePath) && draft.content !== null,
  );
  const adapter = getSsgAdapter(project.ssgType);

  return {
    files: [
      ...files.map((file) => {
        const draft = draftByPath.get(file.path);
        return {
          path: file.path,
          collection: file.collection,
          filename: file.filename,
          sha: file.sha,
          lastSyncedAt: file.lastSyncedAt,
          status: draft?.content === null ? 'pending-delete' : normalizeDraftStatus(draft?.status),
        } satisfies ContentFileSummary;
      }),
      ...localOnlyDrafts.map((draft) => draftToLocalOnlyFileSummary(draft, adapter, project)),
    ],
    syncError,
  };
}

export async function syncProjectContent(
  projectId: string,
  _prevState: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  if (project.isPrivate && !credential.token) {
    return { ok: false, error: 'Connect a GitHub token before syncing a private repository.' };
  }
  try {
    await refreshProjectContentCache(db, tenantId, project, credential.token);
  } catch (error) {
    return { ok: false, error: sanitizePublishError(error) };
  }

  revalidateProject(projectId);
  return { ok: true };
}

export async function getEditorState(
  projectId: string,
  path: string,
  newFileTitle?: string,
): Promise<EditorState> {
  const { db, userId, tenantId } = await getContext();
  const currentUserRole = await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const project = await getProjectRow(db, tenantId, projectId);
  assertContentPathAllowed(project, path);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  const adapter = getSsgAdapter(project.ssgType);
  const collection = adapter.inferCollection(path, project.pathPrefix) ?? 'Root';
  const collectionSchema = await getCollectionSchema(db, tenantId, project.id, collection);
  const schemaFields = collectionSchema ? safeParseSchema(collectionSchema) : [];

  const draftRows = await db
    .select()
    .from(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.filePath, path),
        eq(plainwriteDrafts.userId, userId),
      ),
    )
    .orderBy(desc(plainwriteDrafts.updatedAt))
    .limit(1);
  const draft = draftRows[0];
  if (draft && draft.content !== null && (draft.status === 'draft' || draft.status === 'committed')) {
    return {
      project,
      path,
      content: draft.content,
      baseSha: draft.baseSha,
      status: draft.status,
      commitMessage: draft.commitMessage,
      currentUserRole,
      loadError: null,
      schemaFields,
    };
  }

  const cachedRows = await db
    .select()
    .from(plainwriteFileCache)
    .where(
      and(
        eq(plainwriteFileCache.tenantId, tenantId),
        eq(plainwriteFileCache.projectId, projectId),
        eq(plainwriteFileCache.path, path),
      ),
    )
    .limit(1);
  const cached = cachedRows[0];

  if (project.isPrivate && !credential.token) {
    return {
      project,
      path,
      content: '',
      baseSha: null,
      status: 'unmodified',
      commitMessage: null,
      currentUserRole,
      loadError: 'Connect a GitHub token before opening private repository content.',
      schemaFields,
    };
  }

  try {
    const provider = getGitProvider(project.provider);
    const remote = await provider.getFileContent(project, path, { token: credential.token });
    return {
      project,
      path,
      content: remote.content,
      baseSha: remote.sha,
      status: 'unmodified',
      commitMessage: null,
      currentUserRole,
      loadError: null,
      schemaFields,
    };
  } catch (error) {
    if (error instanceof GitProviderError && error.notFound) {
      return {
        project,
        path,
        content: defaultMarkdownTemplate(path, newFileTitle),
        baseSha: cached?.sha ?? null,
        status: 'unmodified',
        commitMessage: null,
        currentUserRole,
        loadError: null,
        schemaFields,
      };
    }

    // Any error other than a definitive "not found" must not be treated as
    // "new file" — that would let a transient failure masquerade as an empty
    // file, and a subsequent save+publish would overwrite the real remote
    // content with placeholder text (see class doc on EditorState.loadError).
    const message = error instanceof Error ? error.message : 'Could not load the remote file.';
    return {
      project,
      path,
      content: '',
      baseSha: null,
      status: 'unmodified',
      commitMessage: null,
      currentUserRole,
      loadError: message,
      schemaFields,
    };
  }
}

export async function saveDraft(projectId: string, path: string, formData: FormData) {
  await upsertDraft(projectId, path, formData, 'draft');
  revalidateEditor(projectId, path);
}

export async function commitDraft(projectId: string, path: string, formData: FormData) {
  await upsertDraft(projectId, path, formData, 'committed');
  revalidateEditor(projectId, path);
}

export async function createContentFile(projectId: string, formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  const filename = formString(formData, 'filename');
  if (!filename) throw new Error('Filename is required.');
  const title = formString(formData, 'title');

  const path = buildContentFilePath(project.pathPrefix, formString(formData, 'collection'), filename);
  // The title carries through as a query param (read once by the editor
  // page on this first load, never persisted) so the new post's frontmatter
  // seeds with what the writer actually typed instead of reverse-engineering
  // a title from the slugified filename.
  const titleParam = title ? `?title=${encodeURIComponent(title)}` : '';
  redirect(`/plainwrite/${projectId}/editor/${path}${titleParam}`);
}

export async function publishCommittedDraft(
  projectId: string,
  path: string,
  _prevState: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  assertContentPathAllowed(project, path);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  if (!credential.token) {
    return { ok: false, error: 'Connect a GitHub token before publishing.' };
  }

  const draft = await getCurrentUserDraft(db, tenantId, projectId, path, userId);
  if (!draft || draft.status !== 'committed') {
    return { ok: false, error: 'Commit this draft before publishing.' };
  }

  const message = draft.commitMessage || `Update ${path.split('/').at(-1) ?? path}`;
  const provider = getGitProvider(project.provider);
  const adapter = getSsgAdapter(project.ssgType);

  try {
    await assertNoPublishConflict(provider, project, credential.token, path, draft);
    const result = await provider.publishFile(
      project,
      {
        path,
        content: draft.content,
        baseSha: draft.baseSha,
        message,
      },
      { token: credential.token },
    );
    const ts = now();
    await db
      .update(plainwriteDrafts)
      .set({
        status: 'published',
        publishedAt: ts,
        updatedAt: ts,
      })
      .where(eq(plainwriteDrafts.id, draft.id));

    if (draft.content !== null && result.contentSha) {
      await upsertFileCache(db, tenantId, project, {
        path,
        sha: result.contentSha,
        collection: adapter.inferCollection(path, project.pathPrefix),
      });
    } else if (draft.content === null) {
      await deleteFileCache(db, tenantId, project.id, path);
    }

    await insertPublishEvent(db, {
      tenantId,
      projectId,
      userId,
      provider: project.provider,
      branch: project.branch,
      commitSha: result.commitSha,
      message,
      files: [path],
      status: 'success',
      errorCode: null,
      errorSummary: null,
    });
    await notifyAndLogPublish(db, tenantId, project, userId, [path], result.commitSha);
    revalidateEditor(projectId, path);
    return { ok: true };
  } catch (error) {
    const failure = classifyPublishFailure(error);
    await insertPublishEvent(db, {
      tenantId,
      projectId,
      userId,
      provider: project.provider,
      branch: project.branch,
      commitSha: null,
      message,
      files: [path],
      status: 'failed',
      errorCode: failure.code,
      errorSummary: failure.summary,
    });
    revalidateEditor(projectId, path);
    return { ok: false, error: failure.summary };
  }
}

export async function publishAllCommittedDrafts(
  projectId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  if (!credential.token) {
    return { ok: false, error: 'Connect a GitHub token before publishing.' };
  }

  const skipConflicts = formBoolean(formData, 'skipConflicts');
  const drafts = await db
    .select()
    .from(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.userId, userId),
        eq(plainwriteDrafts.status, 'committed'),
      ),
    )
    .orderBy(asc(plainwriteDrafts.filePath));
  if (drafts.length === 0) {
    return { ok: false, error: 'Commit at least one draft before publishing all.' };
  }

  const provider = getGitProvider(project.provider);
  const publishable: PlainwriteDraft[] = [];
  const conflicts: string[] = [];
  for (const draft of drafts) {
    try {
      await assertNoPublishConflict(provider, project, credential.token, draft.filePath, draft);
      publishable.push(draft);
    } catch (error) {
      conflicts.push(`${draft.filePath}: ${sanitizePublishError(error)}`);
    }
  }

  if (conflicts.length > 0 && !skipConflicts) {
    const summary = `Resolve conflicts before publishing all: ${conflicts.join('; ')}`;
    await insertPublishEvent(db, {
      tenantId,
      projectId,
      userId,
      provider: project.provider,
      branch: project.branch,
      commitSha: null,
      message: 'Publish all committed drafts',
      files: drafts.map((draft) => draft.filePath),
      status: 'failed',
      errorCode: 'conflict',
      errorSummary: summary,
    });
    return { ok: false, error: summary };
  }
  if (publishable.length === 0) {
    return { ok: false, error: 'All committed drafts have conflicts.' };
  }

  const message =
    formString(formData, 'message') ||
    `Publish ${publishable.length} ${publishable.length === 1 ? 'file' : 'files'}`;
  const adapter = getSsgAdapter(project.ssgType);

  let result: GitPublishResult;
  try {
    result = await provider.publishFiles(
      project,
      publishable.map((draft) => ({
        path: draft.filePath,
        action: draft.content === null ? 'delete' : draft.baseSha ? 'update' : 'create',
        content: draft.content,
        baseSha: draft.baseSha,
        message: draft.commitMessage,
      })),
      message,
      { token: credential.token },
    );
  } catch (error) {
    const failure = classifyPublishFailure(error);
    await insertPublishEvent(db, {
      tenantId,
      projectId,
      userId,
      provider: project.provider,
      branch: project.branch,
      commitSha: null,
      message,
      files: publishable.map((draft) => draft.filePath),
      status: 'failed',
      errorCode: failure.code,
      errorSummary: failure.summary,
    });
    return { ok: false, error: failure.summary };
  }

  // The GitHub commit above has already landed — from here on, a failure
  // updating our own bookkeeping must never be reported as a failed publish
  // (that would tell the user to retry, and retrying would create a second,
  // conflicting commit for content that's already published). Run each
  // draft's local update independently so one failure can't leave the rest
  // stuck mid-Promise.all, and always record the publish event as a success,
  // surfacing which files had a bookkeeping failure if any did.
  const ts = now();
  const bookkeepingFailures: string[] = [];
  for (const draft of publishable) {
    try {
      await db
        .update(plainwriteDrafts)
        .set({ status: 'published', publishedAt: ts, updatedAt: ts })
        .where(eq(plainwriteDrafts.id, draft.id));

      if (draft.content === null) {
        await deleteFileCache(db, tenantId, project.id, draft.filePath);
      } else {
        const contentSha = result.contentShas?.[draft.filePath];
        if (contentSha) {
          await upsertFileCache(db, tenantId, project, {
            path: draft.filePath,
            sha: contentSha,
            collection: adapter.inferCollection(draft.filePath, project.pathPrefix),
          });
        }
      }
    } catch (error) {
      bookkeepingFailures.push(`${draft.filePath}: ${sanitizePublishError(error)}`);
    }
  }

  const notes = [
    conflicts.length > 0 ? `Skipped conflicts: ${conflicts.join('; ')}` : null,
    bookkeepingFailures.length > 0
      ? `Published to GitHub, but local status update failed for: ${bookkeepingFailures.join('; ')}. Reopen and re-save these files if their status looks stale.`
      : null,
  ].filter((note): note is string => note !== null);

  await insertPublishEvent(db, {
    tenantId,
    projectId,
    userId,
    provider: project.provider,
    branch: project.branch,
    commitSha: result.commitSha,
    message,
    files: publishable.map((draft) => draft.filePath),
    status: 'success',
    errorCode:
      bookkeepingFailures.length > 0
        ? 'partial_bookkeeping_failure'
        : conflicts.length > 0
          ? 'conflicts_skipped'
          : null,
    errorSummary: notes.length > 0 ? notes.join(' ') : null,
  });
  await notifyAndLogPublish(
    db,
    tenantId,
    project,
    userId,
    publishable.map((draft) => draft.filePath),
    result.commitSha,
  );

  revalidateProject(projectId);
  return {
    ok: true,
    message: conflicts.length > 0 ? `Published, skipping conflicts: ${conflicts.join('; ')}` : undefined,
  };
}

export async function stageContentDeletion(projectId: string, path: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const cachedRows = await db
    .select({ sha: plainwriteFileCache.sha })
    .from(plainwriteFileCache)
    .where(
      and(
        eq(plainwriteFileCache.tenantId, tenantId),
        eq(plainwriteFileCache.projectId, projectId),
        eq(plainwriteFileCache.path, path),
      ),
    )
    .limit(1);
  const baseSha = cachedRows[0]?.sha;
  if (!baseSha) throw new Error('Sync this file before staging deletion.');

  const ts = now();
  const existing = await getCurrentUserDraft(db, tenantId, projectId, path, userId);
  if (existing) {
    await db
      .update(plainwriteDrafts)
      .set({
        content: null,
        status: 'committed',
        commitMessage: `Delete ${path.split('/').at(-1) ?? path}`,
        baseSha,
        committedAt: ts,
        updatedAt: ts,
      })
      .where(eq(plainwriteDrafts.id, existing.id));
  } else {
    await db.insert(plainwriteDrafts).values({
      id: randomUUID(),
      tenantId,
      projectId,
      filePath: path,
      userId,
      content: null,
      status: 'committed',
      commitMessage: `Delete ${path.split('/').at(-1) ?? path}`,
      baseSha,
      committedAt: ts,
      publishedAt: null,
      createdAt: ts,
      updatedAt: ts,
    });
  }

  revalidateProject(projectId);
}

export async function updateCollectionSchema(projectId: string, collection: string, formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const fields = schemaFieldsFromForm(formData);
  await upsertCollectionSchema(db, tenantId, projectId, collection, fields, null, userId);
  revalidateProject(projectId);
}

export async function resetCollectionSchema(projectId: string, collection: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const project = await getProjectRow(db, tenantId, projectId);
  const credential = await resolveGitHubCredential(db, tenantId, projectId, userId);
  if (project.isPrivate && !credential.token) {
    throw new Error('Connect a GitHub token before resetting schemas for a private repository.');
  }
  await inferAndUpsertCollectionSchema(db, tenantId, project, credential.token, collection, true);
  revalidateProject(projectId);
}

export async function discardDraft(projectId: string, path: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  await db
    .delete(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.filePath, path),
        eq(plainwriteDrafts.userId, userId),
      ),
    );
  revalidateEditor(projectId, path);
}

export async function connectGitHubPat(projectId: string, formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  const token = formRawString(formData, 'token').trim();
  if (!token) throw new Error('GitHub token is required.');

  const existing = await getCredentialRow(db, tenantId, projectId, userId);
  const provider = getGitProvider(project.provider);
  const credentialMetadata = await provider.validatePat(token, project);
  const secretLabel = `Plainwrite GitHub token for ${project.repoOwner}/${project.repoName}`;
  // Reuse the existing vault secret whenever one exists (not just when
  // status is currently "connected") so reconnecting from `needs_reauth` —
  // the common recovery path after a revoked/expired token — rotates the
  // same secret instead of abandoning it and creating a new orphaned vault
  // entry. Only a PAT-owned secretRef is reused; an OAuth credential's
  // secretRef is owned by its sdk.connections record and must not be
  // mutated directly here.
  let secretRef =
    existing?.authType === 'pat' && existing.secretRef && !existing.secretRef.startsWith('revoked:')
      ? existing.secretRef
      : null;
  if (secretRef) {
    await sdk.secrets.update(secretRef, token);
  } else {
    const secret = await sdk.secrets.create({
      scope: 'user',
      label: secretLabel,
      value: token,
      metadata: {
        provider: 'github',
        projectId,
        repo: `${project.repoOwner}/${project.repoName}`,
      },
    });
    secretRef = secret.id;
  }

  const ts = now();
  const values = {
    tenantId,
    projectId,
    userId,
    provider: 'github',
    authType: 'pat',
    connectionId: null,
    secretRef,
    tokenExpiresAt: null,
    providerLogin: credentialMetadata.login,
    status: 'connected',
    lastError: null,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };

  if (existing) {
    await db
      .update(plainwriteCredentials)
      .set(values)
      .where(
        and(
          eq(plainwriteCredentials.tenantId, tenantId),
          eq(plainwriteCredentials.projectId, projectId),
          eq(plainwriteCredentials.userId, userId),
        ),
      );
  } else {
    await db.insert(plainwriteCredentials).values(values);
  }

  revalidateProject(projectId);
}

export async function startGitHubOAuth(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  await getProjectRow(db, tenantId, projectId);
  const config = await sdk.connections.getProviderConfig('git.github');
  const state = await sdk.connections.createOAuthState({
    provider: 'git.github',
    callbackPath: '/oauth/github/callback',
    metadata: { projectId },
    expiresInSeconds: 600,
  });
  redirect(buildGitHubOAuthUrl(config, state));
}

export async function completeGitHubOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<string> {
  const { db, userId, tenantId } = await getContext();
  const state = await sdk.connections.verifyOAuthState(input.state);
  if (state.provider !== 'git.github') throw new Error('OAuth state provider did not match GitHub.');
  const projectId = typeof state.metadata?.projectId === 'string' ? state.metadata.projectId : null;
  if (!projectId) throw new Error('OAuth state did not include a Plainwrite project.');

  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  const config = await sdk.connections.getProviderConfig('git.github');
  const tokens = await exchangeGitHubOAuthCode(config, input.code);
  const provider = getGitProvider(project.provider);
  const userInfo = await provider.validatePat(tokens.accessToken, project);
  const existingCredential = await getCredentialRow(db, tenantId, projectId, userId);
  const existingConnection = await findGitHubProjectConnection(projectId);
  const secretLabel = `Plainwrite GitHub OAuth token for ${project.repoOwner}/${project.repoName}`;
  let secretRef = existingConnection?.secretRef ?? null;

  if (secretRef) {
    await sdk.secrets.update(secretRef, tokens.accessToken);
  } else {
    const secret = await sdk.secrets.create({
      scope: 'user',
      label: secretLabel,
      value: tokens.accessToken,
      metadata: {
        provider: 'github',
        projectId,
        repo: `${project.repoOwner}/${project.repoName}`,
        authType: 'oauth',
      },
    });
    secretRef = secret.id;
  }

  const connectionMetadata = {
    projectId,
    repo: `${project.repoOwner}/${project.repoName}`,
    login: userInfo.login,
    authType: 'oauth',
    tokenExpiresAt: tokens.expiresAt ?? null,
  };
  const connection = existingConnection
    ? await sdk.connections.update(existingConnection.id, {
        label: secretLabel,
        status: 'connected',
        secretRef,
        metadata: connectionMetadata,
        lastCheckedAt: now(),
      })
    : await sdk.connections.create({
        scope: 'user',
        provider: 'git.github',
        label: secretLabel,
        secretRef,
        metadata: connectionMetadata,
      });

  const ts = now();
  const credentialValues = {
    tenantId,
    projectId,
    userId,
    provider: 'github',
    authType: 'oauth',
    connectionId: connection.id,
    secretRef,
    tokenExpiresAt: tokens.expiresAt ?? null,
    providerLogin: userInfo.login,
    status: 'connected',
    lastError: null,
    createdAt: existingCredential?.createdAt ?? ts,
    updatedAt: ts,
  };

  if (existingCredential) {
    await db
      .update(plainwriteCredentials)
      .set(credentialValues)
      .where(
        and(
          eq(plainwriteCredentials.tenantId, tenantId),
          eq(plainwriteCredentials.projectId, projectId),
          eq(plainwriteCredentials.userId, userId),
        ),
      );
    if (
      existingCredential.authType === 'pat' &&
      existingCredential.secretRef &&
      existingCredential.secretRef !== secretRef &&
      !existingCredential.secretRef.startsWith('revoked:')
    ) {
      await sdk.secrets.delete(existingCredential.secretRef).catch(() => undefined);
    }
  } else {
    await db.insert(plainwriteCredentials).values(credentialValues);
  }

  revalidateProject(projectId);
  return projectId;
}

export async function disconnectGitHubCredential(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const existing = await getCredentialRow(db, tenantId, projectId, userId);
  if (!existing) return;

  // Tolerate the vault entry already being gone (e.g. admin vault cleanup,
  // or a connection revoked out-of-band) — otherwise the user can never
  // disconnect a credential whose backing secret no longer exists.
  try {
    if (existing.connectionId) {
      await sdk.connections.disconnect(existing.connectionId);
    } else if (existing.secretRef && !existing.secretRef.startsWith('revoked:')) {
      await sdk.secrets.delete(existing.secretRef);
    }
  } catch {
    // Continue marking the credential disconnected even if the vault entry
    // or connection was already removed.
  }
  await db
    .update(plainwriteCredentials)
    .set({
      status: 'disconnected',
      lastError: null,
      updatedAt: now(),
    })
    .where(
      and(
        eq(plainwriteCredentials.tenantId, tenantId),
        eq(plainwriteCredentials.projectId, projectId),
        eq(plainwriteCredentials.userId, userId),
      ),
    );

  revalidateProject(projectId);
}

export async function createProject(formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  const name = formString(formData, 'name');
  if (!name) throw new Error('Project name is required.');

  const repositoryUrl = formString(formData, 'repositoryUrl');
  const repo = parseGitHubRepositoryUrl(repositoryUrl);
  const isPrivate = formBoolean(formData, 'isPrivate');
  const defaults = projectInputDefaults({
    branch: formString(formData, 'branch'),
    pathPrefix: formString(formData, 'pathPrefix'),
    ssgType: formString(formData, 'ssgType'),
    metadataVisibility: formString(formData, 'metadataVisibility'),
    isPrivate,
  });
  const id = randomUUID();
  const ts = now();

  await db.insert(plainwriteProjects).values({
    id,
    tenantId,
    createdBy: userId,
    name,
    description: formString(formData, 'description') || null,
    provider: 'github',
    providerUrl: null,
    repoOwner: repo.owner,
    repoName: repo.name,
    branch: defaults.branch,
    pathPrefix: defaults.pathPrefix,
    ssgType: defaults.ssgType,
    isPrivate,
    metadataVisibility: defaults.metadataVisibility,
    archivedAt: null,
    createdAt: ts,
    updatedAt: ts,
  });

  await db.insert(plainwriteProjectMembers).values({
    tenantId,
    projectId: id,
    userId,
    role: 'owner',
    invitedBy: null,
    joinedAt: ts,
  });

  await recordActivity({
    action: 'plainwrite.project.created',
    targetType: 'project',
    targetId: id,
    summary: `Created project "${name}".`,
  });

  revalidatePath('/plainwrite');
  redirect(`/plainwrite/${id}`);
}

export async function updateProjectSettings(projectId: string, formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const isPrivate = formBoolean(formData, 'isPrivate');
  const defaults = projectInputDefaults({
    branch: formString(formData, 'branch'),
    pathPrefix: formString(formData, 'pathPrefix'),
    ssgType: formString(formData, 'ssgType'),
    metadataVisibility: formString(formData, 'metadataVisibility'),
    isPrivate,
  });

  await db
    .update(plainwriteProjects)
    .set({
      name: formString(formData, 'name'),
      description: formString(formData, 'description') || null,
      branch: defaults.branch,
      pathPrefix: defaults.pathPrefix,
      ssgType: defaults.ssgType,
      isPrivate,
      metadataVisibility: defaults.metadataVisibility,
      updatedAt: now(),
    })
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)));

  revalidateProject(projectId);
}

export async function archiveProject(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const project = await getProjectRow(db, tenantId, projectId);
  await db
    .update(plainwriteProjects)
    .set({ archivedAt: now(), updatedAt: now() })
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)));
  await recordActivity({
    action: 'plainwrite.project.archived',
    targetType: 'project',
    targetId: projectId,
    summary: `Archived project "${project.name}".`,
  });
  revalidateProject(projectId);
}

export async function restoreProject(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const project = await getProjectRow(db, tenantId, projectId);
  await db
    .update(plainwriteProjects)
    .set({ archivedAt: null, updatedAt: now() })
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)));
  await recordActivity({
    action: 'plainwrite.project.restored',
    targetType: 'project',
    targetId: projectId,
    summary: `Restored project "${project.name}".`,
  });
  revalidateProject(projectId);
}

export async function hardDeleteProject(projectId: string, formData: FormData) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  if (formString(formData, 'confirm') !== 'DELETE') {
    throw new Error('Type DELETE to permanently delete the project.');
  }
  const project = await getProjectRow(db, tenantId, projectId);

  const credentials = await db
    .select({ secretRef: plainwriteCredentials.secretRef })
    .from(plainwriteCredentials)
    .where(and(eq(plainwriteCredentials.tenantId, tenantId), eq(plainwriteCredentials.projectId, projectId)));
  await Promise.all(
    credentials.map(async (credential) => {
      if (!credential.secretRef || credential.secretRef.startsWith('revoked:')) return;
      try {
        await sdk.secrets.delete(credential.secretRef);
      } catch {
        // Continue deleting plugin-owned rows even if the vault entry was already revoked.
      }
    }),
  );

  await db
    .delete(plainwritePublishEvents)
    .where(and(eq(plainwritePublishEvents.tenantId, tenantId), eq(plainwritePublishEvents.projectId, projectId)));
  await db
    .delete(plainwriteCollectionSchemas)
    .where(and(eq(plainwriteCollectionSchemas.tenantId, tenantId), eq(plainwriteCollectionSchemas.projectId, projectId)));
  await db
    .delete(plainwriteDrafts)
    .where(and(eq(plainwriteDrafts.tenantId, tenantId), eq(plainwriteDrafts.projectId, projectId)));
  await db
    .delete(plainwriteFileCache)
    .where(and(eq(plainwriteFileCache.tenantId, tenantId), eq(plainwriteFileCache.projectId, projectId)));
  await db
    .delete(plainwriteCredentials)
    .where(and(eq(plainwriteCredentials.tenantId, tenantId), eq(plainwriteCredentials.projectId, projectId)));
  await db
    .delete(plainwriteProjectMembers)
    .where(and(eq(plainwriteProjectMembers.tenantId, tenantId), eq(plainwriteProjectMembers.projectId, projectId)));
  await db
    .delete(plainwriteProjects)
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)));

  await recordActivity({
    action: 'plainwrite.project.deleted',
    targetType: 'project',
    targetId: projectId,
    summary: `Permanently deleted project "${project.name}".`,
  });

  revalidatePath('/plainwrite');
  redirect('/plainwrite');
}

/**
 * Backs the member picker's typeahead — search the platform directory by
 * name/email so invitedProjectMember never has to ask a human for a raw
 * internal user id (nobody knows their own id). Viewer role is enough since
 * this only reads display-safe directory fields, not project membership.
 */
export async function searchProjectDirectoryUsers(projectId: string, query: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'viewer');
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return sdk.directory.searchUsers({ query: trimmed, limit: 8 });
}

export async function inviteProjectMember(
  projectId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');
  const invitedUserId = formString(formData, 'userId');
  const role = formString(formData, 'role');
  if (!invitedUserId) return { ok: false, error: 'Choose a member to add.' };
  if (!isProjectRole(role)) return { ok: false, error: 'Invalid project role.' };

  // Resolve against the platform directory before inserting a membership
  // row — otherwise a typo'd ID silently creates a phantom member that never
  // shows up as an active user anywhere (getProject filters display fields
  // through the same resolveUsers call, so a phantom row would just render
  // blank forever instead of failing loudly at invite time).
  const [invitedUser] = await sdk.directory.resolveUsers({ ids: [invitedUserId] });
  if (!invitedUser) return { ok: false, error: 'That user could not be found.' };

  const existing = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
        eq(plainwriteProjectMembers.userId, invitedUserId),
      ),
    )
    .limit(1);

  if (existing.length) {
    const existingMember = existing[0];
    if (existingMember?.role === 'owner' && role !== 'owner') {
      const ownerCount = await countProjectOwners(db, tenantId, projectId);
      if (ownerCount <= 1) {
        return { ok: false, error: 'The last owner cannot be demoted.' };
      }
    }

    await db
      .update(plainwriteProjectMembers)
      .set({ role })
      .where(
        and(
          eq(plainwriteProjectMembers.tenantId, tenantId),
          eq(plainwriteProjectMembers.projectId, projectId),
          eq(plainwriteProjectMembers.userId, invitedUserId),
        ),
      );
  } else {
    await db.insert(plainwriteProjectMembers).values({
      tenantId,
      projectId,
      userId: invitedUserId,
      role,
      invitedBy: userId,
      joinedAt: now(),
    });

    const project = await getProjectRow(db, tenantId, projectId);
    await notifyUser({
      recipientUserId: invitedUserId,
      title: 'Added to a Plainwrite project',
      body: `You were added to "${project.name}" as ${role}.`,
      url: `/plainwrite/${projectId}`,
    });
    await recordActivity({
      action: 'plainwrite.project.member_invited',
      subjectUserId: invitedUserId,
      targetType: 'project',
      targetId: projectId,
      summary: `Invited a member to "${project.name}" as ${role}.`,
    });
  }

  revalidateProject(projectId);
  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${role}.` };
}

export async function removeProjectMember(projectId: string, memberUserId: string) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'owner');

  const members = await db
    .select()
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
      ),
    );
  const target = members.find((member) => member.userId === memberUserId);
  if (!target) return;
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  if (target.userId === userId && target.role === 'owner' && ownerCount <= 1) {
    throw new Error('The last owner cannot remove themselves.');
  }

  await db
    .delete(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
        eq(plainwriteProjectMembers.userId, memberUserId),
      ),
    );

  const project = await getProjectRow(db, tenantId, projectId);
  await recordActivity({
    action: 'plainwrite.project.member_removed',
    subjectUserId: memberUserId,
    targetType: 'project',
    targetId: projectId,
    summary:
      memberUserId === userId
        ? `Left project "${project.name}".`
        : `Removed a member from "${project.name}".`,
  });

  revalidateProject(projectId);
}

async function countProjectOwners(db: Db, tenantId: string, projectId: string) {
  const owners = await db
    .select({ userId: plainwriteProjectMembers.userId })
    .from(plainwriteProjectMembers)
    .where(
      and(
        eq(plainwriteProjectMembers.tenantId, tenantId),
        eq(plainwriteProjectMembers.projectId, projectId),
        eq(plainwriteProjectMembers.role, 'owner'),
      ),
    );
  return owners.length;
}

async function getProjectRow(
  db: Db,
  tenantId: string,
  projectId: string,
): Promise<PlainwriteProject> {
  const rows = await db
    .select()
    .from(plainwriteProjects)
    .where(and(eq(plainwriteProjects.tenantId, tenantId), eq(plainwriteProjects.id, projectId)))
    .limit(1);
  const project = rows[0];
  if (!project) throw new Error('Project not found');
  return project;
}

async function getCredentialRow(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<PlainwriteCredential | null> {
  const rows = await db
    .select()
    .from(plainwriteCredentials)
    .where(
      and(
        eq(plainwriteCredentials.tenantId, tenantId),
        eq(plainwriteCredentials.projectId, projectId),
        eq(plainwriteCredentials.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function resolveGitHubCredential(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
): Promise<{ token: string | null; credential: PlainwriteCredential | null }> {
  const credential = await getCredentialRow(db, tenantId, projectId, userId);
  if (!credential || credential.status !== 'connected') {
    return { token: null, credential };
  }
  if (credential.tokenExpiresAt && credential.tokenExpiresAt <= now() + 60) {
    await markCredentialError(db, tenantId, projectId, userId, 'Credential token expired. Reconnect GitHub.');
    if (credential.connectionId) {
      await sdk.connections
        .markError(credential.connectionId, {
          status: 'needs_reauth',
          error: { code: 'token_expired', message: 'Credential token expired. Reconnect GitHub.' },
        })
        .catch(() => undefined);
    }
    return { token: null, credential };
  }
  if (!credential.secretRef || credential.secretRef.startsWith('revoked:')) {
    return { token: null, credential };
  }

  try {
    const token = await sdk.secrets.get(credential.secretRef);
    if (!token) {
      await markCredentialError(db, tenantId, projectId, userId, 'Credential secret is missing.');
      return { token: null, credential };
    }
    if (credential.connectionId) {
      await sdk.connections.markUsed(credential.connectionId).catch(() => undefined);
    }
    return { token, credential };
  } catch {
    await markCredentialError(db, tenantId, projectId, userId, 'Credential secret could not be read.');
    return { token: null, credential };
  }
}

async function findGitHubProjectConnection(projectId: string) {
  const connections = await sdk.connections.list({
    provider: 'git.github',
    scope: 'user',
    includeDisconnected: true,
  });
  return (
    connections.find((connection) => {
      const metadata = connection.metadata;
      return metadata?.projectId === projectId && metadata?.authType === 'oauth';
    }) ?? null
  );
}

async function markCredentialError(
  db: Db,
  tenantId: string,
  projectId: string,
  userId: string,
  message: string,
) {
  await db
    .update(plainwriteCredentials)
    .set({
      status: 'needs_reauth',
      lastError: message,
      updatedAt: now(),
    })
    .where(
      and(
        eq(plainwriteCredentials.tenantId, tenantId),
        eq(plainwriteCredentials.projectId, projectId),
        eq(plainwriteCredentials.userId, userId),
      ),
    );
}

function shouldRefreshContentCache(lastSyncedAtValues: number[]) {
  if (lastSyncedAtValues.length === 0) return true;
  const oldestSync = Math.min(...lastSyncedAtValues);
  return now() - oldestSync >= CONTENT_SYNC_TTL_SECONDS;
}

function canViewCachedMetadata(project: PlainwriteProject, token: string | null) {
  if (!project.isPrivate) return true;
  if (token) return true;
  return project.metadataVisibility === 'all_members';
}

async function refreshProjectContentCache(
  db: Db,
  tenantId: string,
  project: PlainwriteProject,
  token: string | null,
) {
  const provider = getGitProvider(project.provider);
  const adapter = getSsgAdapter(project.ssgType);
  const tree = await provider.getFileTree(project, { token });
  const files = adapter.discoverContent(tree, project.pathPrefix);
  const ts = now();

  // NOT wrapped in db.transaction(): the SDK's Db type is deliberately
  // dialect-agnostic, but better-sqlite3's own transaction() wrapper
  // synchronously rejects any async callback function ("Transaction
  // function cannot return a promise") — drizzle's better-sqlite3 session
  // passes the callback straight through to it unmodified, so an
  // `await db.transaction(async (tx) => {...})` that type-checks fine
  // throws at runtime on the SQLite path. There's no callback shape that's
  // simultaneously valid for better-sqlite3 (sync only) and Postgres (async
  // only) without branching on dialect, which the SDK's opaque Db type
  // can't do. Falling back to plain sequential delete-then-insert: two
  // concurrent syncs can in theory race into a unique-index error on
  // plainwrite_file_cache, and a crash between the two statements can leave
  // the cache empty until the next TTL sync — low impact and self-healing,
  // matching the original code-review finding this was meant to harden.
  await db
    .delete(plainwriteFileCache)
    .where(
      and(eq(plainwriteFileCache.tenantId, tenantId), eq(plainwriteFileCache.projectId, project.id)),
    );

  if (files.length > 0) {
    await db.insert(plainwriteFileCache).values(
      files.map((file) => ({
        id: randomUUID(),
        tenantId,
        projectId: project.id,
        path: file.path,
        collection: file.collection,
        filename: file.filename,
        sha: file.sha,
        lastSyncedAt: ts,
      })),
    );
  }

  await inferMissingCollectionSchemas(db, tenantId, project, token, files);
}

async function inferMissingCollectionSchemas(
  db: Db,
  tenantId: string,
  project: PlainwriteProject,
  token: string | null,
  files: ContentFile[],
) {
  const collections = [...new Set(files.map((file) => file.collection ?? 'Root'))];
  await Promise.all(
    collections.map(async (collection) => {
      const existing = await getCollectionSchema(db, tenantId, project.id, collection);
      if (existing?.updatedBy) return;
      if (existing && existing.schemaJson !== '[]') return;
      try {
        await inferAndUpsertCollectionSchema(db, tenantId, project, token, collection, false, files);
      } catch {
        // Schema inference is best-effort and should not block repository sync.
      }
    }),
  );
}

async function inferAndUpsertCollectionSchema(
  db: Db,
  tenantId: string,
  project: PlainwriteProject,
  token: string | null,
  collection: string,
  overwriteManual: boolean,
  knownFiles?: ContentFile[],
) {
  const existing = await getCollectionSchema(db, tenantId, project.id, collection);
  if (existing?.updatedBy && !overwriteManual) return;

  const provider = getGitProvider(project.provider);
  const files =
    knownFiles ??
    (await db
      .select()
      .from(plainwriteFileCache)
      .where(
        and(
          eq(plainwriteFileCache.tenantId, tenantId),
          eq(plainwriteFileCache.projectId, project.id),
        ),
      ));
  const samples = files
    .filter((file) => (file.collection ?? 'Root') === collection)
    .slice(0, 5);
  const contents = (
    await Promise.all(
      samples.map(async (file) => {
        try {
          const remote = await provider.getFileContent(project, file.path, { token });
          return remote.content;
        } catch {
          return null;
        }
      }),
    )
  ).filter((content): content is string => content !== null);
  const fields = inferCollectionSchema(contents);
  await upsertCollectionSchema(db, tenantId, project.id, collection, fields, now(), null);
}

async function getCollectionSchema(
  db: Db,
  tenantId: string,
  projectId: string,
  collection: string,
): Promise<PlainwriteCollectionSchema | null> {
  const rows = await db
    .select()
    .from(plainwriteCollectionSchemas)
    .where(
      and(
        eq(plainwriteCollectionSchemas.tenantId, tenantId),
        eq(plainwriteCollectionSchemas.projectId, projectId),
        eq(plainwriteCollectionSchemas.collection, collection),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function upsertCollectionSchema(
  db: Db,
  tenantId: string,
  projectId: string,
  collection: string,
  fields: CollectionSchemaField[],
  inferredAt: number | null,
  updatedBy: string | null,
) {
  const ts = now();
  const existing = await getCollectionSchema(db, tenantId, projectId, collection);
  const values = {
    schemaJson: serializeSchemaFields(fields),
    inferredAt,
    updatedAt: ts,
    updatedBy,
  };

  if (existing) {
    await db
      .update(plainwriteCollectionSchemas)
      .set(values)
      .where(eq(plainwriteCollectionSchemas.id, existing.id));
    return;
  }

  await db.insert(plainwriteCollectionSchemas).values({
    id: randomUUID(),
    tenantId,
    projectId,
    collection,
    ...values,
  });
}

function safeParseSchema(row: PlainwriteCollectionSchema): CollectionSchemaField[] {
  try {
    return parseSchemaJson(row.schemaJson);
  } catch {
    return [];
  }
}

async function upsertDraft(
  projectId: string,
  path: string,
  formData: FormData,
  status: 'draft' | 'committed',
) {
  const { db, userId, tenantId } = await getContext();
  await requireProjectRole(db, tenantId, projectId, userId, 'editor');
  const project = await getProjectRow(db, tenantId, projectId);
  assertContentPathAllowed(project, path);
  const content = formRawString(formData, 'content');
  const baseSha = formString(formData, 'baseSha') || null;
  const commitMessage =
    formString(formData, 'commitMessage') ||
    (status === 'committed' ? `Update ${path.split('/').at(-1) ?? path}` : null);
  const ts = now();

  const existing = await db
    .select({ id: plainwriteDrafts.id })
    .from(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.filePath, path),
        eq(plainwriteDrafts.userId, userId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(plainwriteDrafts)
      .set({
        content,
        status,
        commitMessage,
        baseSha,
        committedAt: status === 'committed' ? ts : null,
        updatedAt: ts,
      })
      .where(eq(plainwriteDrafts.id, existing[0].id));
  } else {
    await db.insert(plainwriteDrafts).values({
      id: randomUUID(),
      tenantId,
      projectId,
      filePath: path,
      userId,
      content,
      status,
      commitMessage,
      baseSha,
      committedAt: status === 'committed' ? ts : null,
      publishedAt: null,
      createdAt: ts,
      updatedAt: ts,
    });
  }
}

async function getCurrentUserDraft(
  db: Db,
  tenantId: string,
  projectId: string,
  path: string,
  userId: string,
): Promise<PlainwriteDraft | null> {
  const rows = await db
    .select()
    .from(plainwriteDrafts)
    .where(
      and(
        eq(plainwriteDrafts.tenantId, tenantId),
        eq(plainwriteDrafts.projectId, projectId),
        eq(plainwriteDrafts.filePath, path),
        eq(plainwriteDrafts.userId, userId),
      ),
    )
    .orderBy(desc(plainwriteDrafts.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function assertNoPublishConflict(
  provider: ReturnType<typeof getGitProvider>,
  project: PlainwriteProject,
  token: string,
  path: string,
  draft: PlainwriteDraft,
) {
  if (draft.content === null && !draft.baseSha) {
    throw new Error('Cannot publish a delete without a remote base revision.');
  }

  try {
    const remote = await provider.getFileContent(project, path, { token });
    if (!draft.baseSha) {
      throw new Error('Conflict: remote file already exists.');
    }
    if (remote.sha !== draft.baseSha) {
      throw new Error('Conflict: remote file changed since this draft was opened.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Conflict:')) throw error;
    if (message.includes('not found') || message.includes('not access it')) {
      if (draft.baseSha) throw new Error('Conflict: remote file no longer exists.');
      return;
    }
    throw error;
  }
}

async function upsertFileCache(
  db: Db,
  tenantId: string,
  project: PlainwriteProject,
  file: Pick<PlainwriteFileCacheEntry, 'path' | 'sha' | 'collection'>,
) {
  const filename = file.path.split('/').at(-1) ?? file.path;
  const existing = await db
    .select({ id: plainwriteFileCache.id })
    .from(plainwriteFileCache)
    .where(
      and(
        eq(plainwriteFileCache.tenantId, tenantId),
        eq(plainwriteFileCache.projectId, project.id),
        eq(plainwriteFileCache.path, file.path),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(plainwriteFileCache)
      .set({
        collection: file.collection,
        filename,
        sha: file.sha,
        lastSyncedAt: now(),
      })
      .where(eq(plainwriteFileCache.id, existing[0].id));
    return;
  }

  await db.insert(plainwriteFileCache).values({
    id: randomUUID(),
    tenantId,
    projectId: project.id,
    path: file.path,
    collection: file.collection,
    filename,
    sha: file.sha,
    lastSyncedAt: now(),
  });
}

async function deleteFileCache(db: Db, tenantId: string, projectId: string, path: string) {
  await db
    .delete(plainwriteFileCache)
    .where(
      and(
        eq(plainwriteFileCache.tenantId, tenantId),
        eq(plainwriteFileCache.projectId, projectId),
        eq(plainwriteFileCache.path, path),
      ),
    );
}

async function insertPublishEvent(
  db: Db,
  event: {
    tenantId: string;
    projectId: string;
    userId: string;
    provider: string;
    branch: string;
    commitSha: string | null;
    message: string;
    files: string[];
    status: 'success' | 'failed';
    errorCode: string | null;
    errorSummary: string | null;
  },
) {
  await db.insert(plainwritePublishEvents).values({
    id: randomUUID(),
    tenantId: event.tenantId,
    projectId: event.projectId,
    userId: event.userId,
    provider: event.provider,
    branch: event.branch,
    commitSha: event.commitSha,
    message: event.message,
    files: JSON.stringify(event.files),
    status: event.status,
    errorCode: event.errorCode,
    errorSummary: event.errorSummary,
    createdAt: now(),
  });
}

/** Records the project-level publish activity event, then notifies every
 * other project member (never the publisher) that new content went out. */
async function notifyAndLogPublish(
  db: Db,
  tenantId: string,
  project: PlainwriteProject,
  publisherId: string,
  files: string[],
  commitSha: string | null,
) {
  const summary = `Published ${files.length === 1 ? '1 file' : `${files.length} files`} to "${project.name}".`;
  await recordActivity({
    action: 'plainwrite.project.published',
    targetType: 'project',
    targetId: project.id,
    summary,
    metadata: { files, commitSha },
  });

  const members = await db
    .select({ userId: plainwriteProjectMembers.userId })
    .from(plainwriteProjectMembers)
    .where(
      and(eq(plainwriteProjectMembers.tenantId, tenantId), eq(plainwriteProjectMembers.projectId, project.id)),
    );
  await Promise.all(
    members
      .filter((member) => member.userId !== publisherId)
      .map((member) =>
        notifyUser({
          recipientUserId: member.userId,
          title: 'New content published',
          body: summary,
          url: `/plainwrite/${project.id}`,
        }),
      ),
  );
}

function classifyPublishFailure(error: unknown) {
  const summary = sanitizePublishError(error);
  const lower = summary.toLowerCase();
  if (lower.includes('conflict') || lower.includes('changed') || lower.includes('no longer exists')) {
    return { code: 'conflict', summary };
  }
  if (lower.includes('scope') || lower.includes('permission')) {
    return { code: 'missing_scope', summary };
  }
  if (lower.includes('rate limited')) {
    return { code: 'rate_limited', summary };
  }
  if (lower.includes('branch')) {
    return { code: 'protected_branch', summary };
  }
  return { code: 'provider_error', summary };
}

function sanitizePublishError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]');
}

function parsePublishedFiles(value: string) {
  try {
    const files = JSON.parse(value);
    return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeDraftStatus(
  status: string | undefined,
): ContentFileSummary['status'] {
  if (status === 'draft' || status === 'committed') return status;
  return 'unmodified';
}

export async function requireEditAccess(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  return requireProjectRole(db, tenantId, projectId, userId, 'editor');
}

export async function requirePublishAccess(projectId: string) {
  const { db, userId, tenantId } = await getContext();
  return requireProjectRole(db, tenantId, projectId, userId, 'editor');
}

function revalidateProject(projectId: string) {
  revalidatePath('/plainwrite');
  revalidatePath(`/plainwrite/${projectId}`);
  revalidatePath(`/plainwrite/${projectId}/settings`);
}

function revalidateEditor(projectId: string, path: string) {
  revalidateProject(projectId);
  revalidatePath(`/plainwrite/${projectId}/editor/${path}`);
}
