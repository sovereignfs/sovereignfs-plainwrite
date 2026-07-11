# Plainwrite Roadmap

**Source spec:** `SPEC.md` v0.3\
**Status:** Draft implementation queue\
**Repository target:** `sovereign-plainwrite`.

This roadmap converts the Plainwrite SPEC into stable implementation tasks for
AI agents. Tasks are ordered; each task depends on the previous task unless
explicitly marked `[parallel]`. Do not renumber task IDs once implementation
starts.

## Milestones

| Milestone | Scope | Done when |
| --------- | ----- | --------- |
| v0.1 | GitHub + Astro core workflow | A user can connect a GitHub repo, browse Astro content, edit Markdown/frontmatter, commit locally, publish directly to GitHub, and see conflict or provider failure feedback. |
| v0.2 | Rich text, Jekyll, images | Non-technical users can edit without Markdown syntax, Jekyll content can be managed, and images can be uploaded to the repo. |
| v0.3 | Collaboration and conflict resolution | Multiple users can see edit presence, resolve conflicts in UI, and configure custom SSG content paths. |
| v1.0 | Stable reference plugin | Plainwrite is documented as the reference plugin for third-party APIs, runtime credentials, and git-backed authoring. |

## v0.1 Core

### ✅ PLW-001 Scaffold Plugin Repository And Manifest

**Spec refs:** Identity and manifest, Directory structure, SDK dependencies.

**Status:** ✅ Scaffold complete; ready for PLW-002.

Progress as of 2026-07-06:

- [x] Added `manifest.json` with platform identity, route prefix, portability
  data contracts, GitHub connection provider metadata, and `0.18.2`
  compatibility.
- [x] Added package metadata, TypeScript config, CSS module typing, gitignore,
  README, and Lucide-based `icon.svg`.
- [x] Added placeholder app routes for overview, project files, project
  settings, editor, and GitHub OAuth callback.
- [x] Added provider and SSG placeholder modules for GitHub and Astro.
- [x] Added database and migration placeholder structure.
- [x] Validated the manifest against the platform manifest schema.
- [x] Run full plugin typecheck after dependencies are installed or the repo is
  linked under the platform plugin workspace.

Create the external plugin repository structure with the SPEC's `manifest.json`,
`icon.svg`, route shell, package metadata, SDK/UI dependencies, and initial app
routes.

Implementation requirements:

- Manifest declares `id: fs.sovereign.plainwrite`, `type: sovereign`,
  `runtime: native`, `routePrefix: /plainwrite`, `database: shared`, required
  permissions including `data:export` and `data:import`, `data.provides`, and
  `connections.providers.git.github`.
- Manifest sets `compatibility.minPlatformVersion` to `0.18.2` unless the
  implementation deliberately drops a dependency and proves an earlier platform
  version is sufficient.
- Repository layout matches the SPEC directory structure.
- Route shell includes the projects overview route and placeholder project,
  settings, editor, and OAuth callback routes.
- No plugin code imports platform internals; use `@sovereignfs/sdk` and
  `@sovereignfs/ui`.
- Reuse existing UI primitives first: `StatusBadge`, `SplitPane`, `TagInput`,
  `CodeTextarea`, `Textarea`, `Input`, `Select`, `Toggle`, `Tabs`, `FormField`,
  `Button`, and `Badge`.

Acceptance criteria:

- Manifest validates with the Sovereign manifest validator.
- Manifest portability permissions match the registered export/import handlers
  planned in PLW-010.
- Plugin can be installed or discovered by the platform in development.
- Placeholder routes render without runtime errors.

Verification:

- Run manifest validation.
- Run typecheck for the plugin package.

### ✅ PLW-002 Add Database Schema And Migrations

**Spec refs:** Data model.

**Status:** ✅ Complete.

Progress as of 2026-07-06:

- [x] Added typed schema helpers for all seven `plainwrite_*` tables.
- [x] Added `tenant_id` to every table.
- [x] Added `secret_ref`, `connection_id`, status, and sanitized metadata
  fields for credentials without plaintext token columns.
- [x] Added required project/user, project/path, project/file/user, and
  project/collection uniqueness constraints.
- [x] Added SQLite and Postgres initial Drizzle migrations.
- [x] Verified SQLite migrations apply cleanly from an empty database.
- [x] Verified plugin typecheck passes.

Create migrations and typed schema helpers for all seven `plainwrite_*` tables.

Implementation requirements:

- Add `plainwrite_projects`, `plainwrite_project_members`,
  `plainwrite_credentials`, `plainwrite_file_cache`, `plainwrite_drafts`,
  `plainwrite_collection_schemas`, and `plainwrite_publish_events`.
- Every table includes `tenant_id`.
- `plainwrite_credentials` stores `secret_ref`, `connection_id`, status, and
  sanitized metadata only. It must not store plaintext or plugin-local encrypted
  token columns.
- Add required unique indexes:
  - `plainwrite_project_members`: `(project_id, user_id)`.
  - `plainwrite_credentials`: `(project_id, user_id)`.
  - `plainwrite_file_cache`: `(project_id, path)`.
  - `plainwrite_drafts`: `(project_id, file_path, user_id)`.
  - `plainwrite_collection_schemas`: `(project_id, collection)`.
- `plainwrite_publish_events` is append-only at the application layer.

Acceptance criteria:

- Migrations apply cleanly from an empty database.
- Schema helpers expose typed access for all tables.
- No migration creates token plaintext or AES-GCM fallback columns.

Verification:

- Run database migration tests or local migration apply/check command.
- Run typecheck.

### ✅ PLW-003 Implement Project CRUD And Membership

**Spec refs:** PLW-01 through PLW-05, Access control.

**Status:** ✅ Complete.

Progress as of 2026-07-06:

- [x] Added project create, list, detail, settings update, archive, restore, and
  hard-delete server actions.
- [x] Added GitHub repository URL parsing and validation into `repo_owner` and
  `repo_name`.
- [x] Insert project creator membership as `owner`.
- [x] Added owner, editor, and viewer role helpers for current and future edit
  and publish flows.
- [x] Added owner-only member invite/update/remove actions with last-owner
  self-removal protection.
- [x] Hid archived projects from the active listing while keeping a separate
  archived section for restore/delete.
- [x] Added project create/detail/settings UI forms.
- [x] Added unit tests for repository parsing, default input normalization, and
  role authorization.

Implement project creation, settings, archive, membership, and role checks.

Implementation requirements:

- Project creation captures name, description, repository URL, provider, branch,
  path prefix, SSG type, privacy flag, and `metadata_visibility`.
- Parse and validate GitHub repository URLs into `repo_owner` and `repo_name`.
- Insert creator as `owner`.
- Support `owner`, `editor`, and `viewer` roles.
- Owners can invite and remove members; the last owner cannot remove themselves.
- Archived projects are hidden from default listing and can be restored or hard
  deleted through an explicit confirmation path.
- Platform plugin access policy remains separate from Plainwrite membership.

Acceptance criteria:

- Users only see projects they created or were invited to.
- Role checks block unauthorized settings, membership, edit, commit, and publish
  actions.
- Private project metadata visibility defaults to `members_with_credentials`.

Verification:

- Add unit/integration tests for project CRUD and role checks.
- Run typecheck and tests.

### ✅ PLW-004 Implement GitHub PAT Credentials With Secret Vault

**Spec refs:** PLW-06, PLW-07, OAuth flow, Credential encryption.

**Status:** ✅ Complete.

Progress as of 2026-07-07:

- [x] Added project settings UI for each editor/owner to connect a GitHub PAT.
- [x] Validates the PAT against GitHub and resolves the provider login before
  storing metadata.
- [x] Stores token material only with `sdk.secrets`; Plainwrite stores
  `secret_ref`, provider, `auth_type`, provider login, status, and sanitized
  error metadata.
- [x] Reconnecting creates or rotates the platform vault secret without exposing
  the token; reconnecting from `needs_reauth` reuses the existing PAT-owned
  secret instead of orphaning it.
- [x] Disconnect deletes the platform vault secret and marks the credential
  disconnected without deleting drafts; tolerates the vault secret or OAuth
  connection already being gone.
- [x] Sync and editor file reads use the current user's connected token when
  available and require it for private repositories.
- [x] Documented required GitHub token contents read/write permissions in UI
  help copy and README.
- [x] Added tests proving token values are not written to plugin tables.

Implement PAT-backed GitHub connection before OAuth.

Implementation requirements:

- Accept a user-entered GitHub PAT for a specific project.
- Store token material immediately with `sdk.secrets.create({ scope: 'user' })`.
- Store only `secret_ref`, provider, `auth_type: pat`, provider login, status,
  and sanitized error metadata in `plainwrite_credentials`.
- Resolve and display the provider login after connect.
- Disconnect removes or revokes local vault references and marks credential
  status appropriately without deleting drafts.
- Required scopes are documented in UI/help copy: contents read/write for the
  selected repository.

Acceptance criteria:

- PAT is never persisted in Plainwrite tables, logs, errors, exports, or client
  payloads after submission.
- Re-authentication rotates the vault secret reference.
- Disconnected credentials cannot be used for sync or publish.

Verification:

- Add tests proving token values are not written to plugin tables.
- Run typecheck and tests.

### ✅ PLW-005 Implement GitHub Provider And Astro Adapter

**Spec refs:** Git provider adapter, SSG adapter, PLW-08 through PLW-10.

**Status:** ✅ Complete for v0.1 read-only sync. Publish remains in PLW-007.

Progress as of 2026-07-07:

- [x] Added Astro Markdown/MDX discovery for files under `path_prefix`.
- [x] Grouped files directly under the path prefix as `Root` and immediate
  subdirectories as collections.
- [x] Added manual project sync for public GitHub repositories using the GitHub
  tree API.
- [x] Refreshes `plainwrite_file_cache` with path, collection, filename, SHA,
  and sync timestamp.
- [x] Project dashboard lists cached content files with per-user status badges.
- [x] Replaced direct server-action fetch/discovery helpers with Git provider
  and SSG adapter interfaces.
- [x] Uses the current user's project credential for private repository sync and
  content reads.
- [x] Added TTL-based sync on project load.
- [x] Enforces `metadata_visibility` for private repository cache display.
- [x] Added provider and adapter tests.

Implement the v0.1 GitHub provider and first-class Astro SSG adapter plus
read-only file sync.

Implementation requirements:

- Add `GitProviderAdapter` and `SsgAdapter` interfaces.
- Implement `GitHubProvider` for file tree and file content reads using the
  current user's credential.
- Implement `AstroAdapter` for `src/content`, `.md`, `.mdx`, files directly in
  the path prefix as "Root", and immediate subdirectory collection grouping.
- Implement manual sync and TTL-based sync on project load.
- Refresh `plainwrite_file_cache` with path, collection, filename, SHA, and sync
  timestamp.
- Respect `metadata_visibility` for private repositories and members without
  credentials.

Acceptance criteria:

- A connected user can sync and browse Markdown files under `path_prefix`.
- Viewers without credentials see cached metadata only when allowed by project
  settings.
- Status badges show at least `Unmodified`, `Draft`, `Committed`, and
  `Conflict` states where data exists.

Verification:

- Add unit tests for Astro content discovery, Astro root-file handling, Astro
  collection grouping, and GitHub URL parsing.
- Add integration tests for sync/cache behavior with mocked provider responses.
- Run typecheck and tests.

### ✅ PLW-006 Implement Editor, Drafts, And Sanitized Preview

**Spec refs:** PLW-11 through PLW-20.

**Status:** ✅ Complete.

Progress as of 2026-07-07, remainder completed 2026-07-10:

- [x] Editor opens provider content unless the current user has an active
  `draft` or `committed` draft.
- [x] Manual save persists the editor body to `plainwrite_drafts` as `draft`.
- [x] Commit action marks the current editor body as `committed` with a commit
  message.
- [x] Discard removes the active current-user draft and reloads provider
  content.
- [x] Viewer roles can open editor content read-only; editor actions require
  project edit access.
- [x] Project dashboard reflects draft/committed file status for the current
  user.
- [x] Add explicit discard confirmation.
- [x] Add collection-aware new-file creation and slug generation.
- [x] Split editor content into raw YAML frontmatter and Markdown body.
- [x] Add sanitized Markdown preview with raw HTML and MDX execution disabled.
- [x] Add editor helper tests for frontmatter parsing, slug generation, path
  generation, and preview escaping.
- [x] Add staged deletion drafts with `content: null` (delivered under
  PLW-008's `stageContentDeletion`/publish-all scope; unchecked here by
  oversight — no PLW-006-specific work remained).
- [x] Parse and serialize frontmatter with `gray-matter` (`editor-rules.ts`'s
  `parseMarkdownDocument` now parses via gray-matter instead of a hand-rolled
  regex, matching what `schema-rules.ts` already used for schema inference).
- [x] Add structured frontmatter fields and raw YAML toggle. `getEditorState`
  resolves the file's collection schema and returns `schemaFields`;
  `MarkdownEditor` renders one typed control per field (`Input`/`Checkbox`/
  `TagInput`/date `Input`) via a `SegmentedControl` "Structured"/"Raw YAML"
  toggle, defaulting to structured when a schema exists. Fields outside the
  schema round-trip untouched. Raw YAML text stays the single source of
  truth; structured edits write back into it immediately.
- [x] Add autosave after idle typing (2s debounce, same `saveAction` the
  manual "Save draft" button uses). Tracks a `lastSaved` baseline (not the
  originally-loaded content) so autosave correctly clears the dirty/
  `beforeunload` flag instead of re-triggering itself.
- [x] Add editor lifecycle integration tests —
  `app/_lib/__tests__/actions-editor-lifecycle.test.ts` covers open (no
  draft) → save → reopen (shows draft) → commit → reopen (shows committed) →
  discard → reopen (back to provider content), plus a published-draft-is-
  ignored-on-reopen case and `schemaFields` population.

Build the editing workflow through local draft commit state, without remote
publishing yet.

Implementation requirements:

- Open existing files from provider content unless the current user has an active
  `draft` or `committed` draft.
- Create new files with collection-aware paths and slugified lowercase kebab-case
  filenames.
- Implement staged deletion as a draft with `content: null`.
- Parse and serialize frontmatter with `gray-matter`.
- Render structured frontmatter fields from the collection schema.
- Include a raw YAML toggle and parse raw YAML back into structured fields.
- Implement Markdown body editor with sanitized live preview. Disable raw HTML
  rendering and MDX execution in v0.1.
- Implement auto-save, manual save, commit, discard, and draft reopen behavior.

Acceptance criteria:

- Drafts are user-scoped; one user's draft does not replace another user's draft.
- `published` drafts are ignored on reopen and fresh provider content is fetched.
- Preview rendering cannot execute script, raw HTML, or MDX.
- Discard clears the active draft after explicit confirmation.

Verification:

- Add tests for draft lifecycle, frontmatter parsing, slug generation, and
  preview sanitization.
- Run typecheck and tests.

### ✅ PLW-007 Implement Single-File Publish And Audit Events

**Spec refs:** PLW-21, PLW-23, Multi-file publish GitHub details,
`plainwrite_publish_events`.

**Status:** ✅ Complete for direct single-file create/update publish. Staged
deletion UI and publish-all remain in PLW-008; pull-request publishing remains a
later enhancement.

Progress as of 2026-07-07:

- [x] Added GitHub contents API write support for single-file create/update.
- [x] Added provider delete support for the future staged deletion flow.
- [x] Added `publishCommittedDraft` server action using the current user's
  connected credential.
- [x] Fetches the current remote blob SHA before publish and blocks conflicts.
- [x] Preserves committed drafts on conflict, missing scope, protected branch,
  rate limit, or other provider failures.
- [x] Marks drafts `published`, sets `published_at`, updates local file cache,
  and stores the provider commit SHA after success.
- [x] Records `plainwrite_publish_events` rows for success and failure.
- [x] Shows recent publish audit events on the project dashboard.
- [x] Added GitHub provider mock tests for create/update and delete request
  construction.

Implement direct GitHub publish for one committed draft.

Implementation requirements:

- Before publish, fetch the current remote blob SHA and compare it to
  `base_sha`.
- Block publish on conflict and preserve the committed draft.
- Publish create/update/delete actions through the GitHub provider using the
  current user's credential.
- Record a `plainwrite_publish_events` row for success and failure.
- Normalize provider failures such as `protected_branch`, `missing_scope`,
  `conflict`, `rate_limited`, and non-fast-forward ref update.
- On success, mark draft `published`, set `published_at`, update file cache, and
  store provider commit SHA in the event.

Acceptance criteria:

- Direct publish succeeds for an unprotected branch when token scopes are valid.
- Protected branch or missing scope failures produce clear user-facing errors and
  append failed publish events.
- No provider response bodies or credential-bearing URLs are stored in
  `error_summary`.

Verification:

- Add provider mock tests for success, conflict, protected branch, missing scope,
  and rate limit.
- Run typecheck and tests.

### ✅ PLW-008 Implement Publish All, Staged Deletion, And Schema Tools

**Spec refs:** PLW-22 through PLW-25.

**Status:** ✅ Complete.

Progress as of 2026-07-07:

- [x] Added GitHub publish-all support using one Git data commit for committed
  edits and staged deletions.
- [x] Added preflight conflict checks across all committed drafts.
- [x] Added skip-conflicts behavior for publish-all while preserving conflicted
  drafts.
- [x] Added staged deletion from the file listing with `content: null`
  committed drafts.
- [x] Updates published drafts, file cache entries, deletion cache state, and
  publish audit events after publish-all.
- [x] Infers collection schemas on content sync from up to five files per
  collection.
- [x] Added owner-only schema editing and reset-to-inferred controls.
- [x] Manual schema edits are preserved across future syncs unless reset.
- [x] Added tests for multi-file publish request construction and schema
  inference/form normalization.
- [x] Verified plugin tests and typecheck pass.

Complete the v0.1 multi-file and schema workflow.

Implementation requirements:

- Publish all current user's committed drafts in one provider commit where GitHub
  supports it.
- Run conflict checks across all files before publish.
- Show conflict summary; allow skip conflicted files or abort entire push.
- Support staged deletions in publish all.
- Infer collection schemas on first sync by fetching up to five files per
  collection and parsing frontmatter.
- Allow project owners to manually edit schemas, mark required fields, and reset
  to inferred schema.
- Manual schema edits are not overwritten by future syncs unless reset.

Acceptance criteria:

- Publish all creates one commit for all selected non-conflicted changes.
- Conflicted files are never silently overwritten.
- Schema inference produces editable schemas for Astro collections.
- Schema editing is owner-only.

Verification:

- Add tests for multi-file publish request construction, conflict summary,
  staged deletion, and schema inference.
- Run typecheck and tests.

### ✅ PLW-009 Add GitHub OAuth Through Connections

**Spec refs:** PLW-06, PLW-07, OAuth flow, SDK dependencies.

**Status:** ✅ Complete.

Progress as of 2026-07-07:

- [x] Uses the manifest-declared `git.github` provider config through
  `sdk.connections`.
- [x] Starts GitHub OAuth with `sdk.connections.createOAuthState()` and the
  effective provider callback URL/scopes.
- [x] Verifies callback state with `sdk.connections.verifyOAuthState()`.
- [x] Exchanges GitHub authorization codes server-side and stores access tokens
  in `sdk.secrets`.
- [x] Creates or updates `sdk.connections` metadata with provider login,
  project/repository metadata, and `secret_ref`.
- [x] Stores Plainwrite credential metadata linked to `connection_id` and
  `secret_ref`.
- [x] Marks expiring OAuth-backed credentials as `needs_reauth` before use.
- [x] Keeps PAT fallback visible when OAuth provider config is missing.
- [x] Added tests for OAuth URL construction, scope normalization, token
  exchange, and missing config handling.
- [x] Verified plugin tests and typecheck pass.

Add hosted GitHub OAuth after PAT-backed sync and publishing are stable.

Implementation requirements:

- Use manifest-declared `connections.providers.git.github`.
- Read effective provider config from `sdk.connections`.
- Start OAuth with `sdk.connections.createOAuthState()`.
- Verify callback state with `sdk.connections.verifyOAuthState()`.
- Exchange code server-side and store token material in `sdk.secrets`.
- Create or update `sdk.connections` metadata with provider login and
  `secret_ref`.
- Store Plainwrite credential metadata linked to `connection_id` and
  `secret_ref`.
- Refresh expiring tokens before API calls where provider tokens expire.
- Mark credentials `needs_reauth` with sanitized errors on refresh failure.

Acceptance criteria:

- OAuth connect works when GitHub provider config is present.
- PAT fallback remains available when OAuth is not configured.
- OAuth state is expiry-bound, user-bound, plugin-bound, and one-time use through
  the platform SDK.

Verification:

- Add callback tests for valid state, invalid state, missing config, token
  exchange failure, and refresh failure.
- Run typecheck and tests.

### ✅ PLW-010 Add Data Contracts, Portability, Activity, And Notifications

**Spec refs:** Current platform refresh, SDK dependencies, Data contracts,
Portability and deletion.

**Status:** ✅ Complete.

Expose platform integrations after the core project workflow exists.

Progress as of 2026-07-10:

- [x] Restored `notifications:send`, `data:provide`, `data:export`,
  `data:import`, and `activity:write` to `manifest.json` `permissions`, and
  the `plainwrite.projects`/`plainwrite.content-index`/`plainwrite.drafts`
  `data.provides` entries.
- [x] Implemented the three read-only data contracts in
  `app/_lib/data-contracts.ts`, registered via `sdk.data.provide()` from
  `app/layout.tsx` (in-process registry — see the file's own docblock for the
  re-register-per-request caveat).
  - `plainwrite.projects` v1 — non-archived projects the current user is a
    member of, with their role.
  - `plainwrite.content-index` v1 — file metadata (path/collection/filename/
    lastSyncedAt) for projects the user can access, filtered by the same
    private-project visibility rule the UI uses
    (`!isPrivate || metadataVisibility === 'all_members'`; a resolver has no
    per-request GitHub credential to fall back on the way the UI does).
    **No body snippets** — `plainwrite_file_cache` has never cached file
    bodies, only metadata, so "searchable snippets" from SPEC.md's original
    description are deferred until content caching exists.
  - `plainwrite.drafts` v1 — metadata only (no `content` field), per SPEC.md.
- [x] Implemented export/import/delete participation in
  `app/_lib/portability.ts`, registered via `sdk.portability.provideExport/
  provideImport/provideDelete()` from `app/layout.tsx`.
  - Export: the user's **owned** projects (full settings) plus their schemas,
    file cache metadata, and publish history; the user's own **drafts across
    every project they're a member of** (owned or not — drafts are personal
    work); credential **metadata only** (provider/authType/providerLogin,
    never `secretRef`) as an informational reconnect checklist.
  - Import: additive, remaps project ids via `ctx.remapId`; a draft whose
    project wasn't in the export (i.e. the exporting user was a member, not
    owner) has nothing to attach to and is skipped. Credentials are never
    restored — the user must reconnect, per SPEC.md.
  - Delete: revokes and deletes the user's vault-backed credentials and
    drafts; for each project membership, removes it if another owner exists,
    **transfers ownership to the longest-tenured other member** if the user
    was the sole owner but other members remain, or **hard-deletes the whole
    project** if the user was its only member. Remote git history is
    untouched (lives outside Sovereign).
- [x] Added `notifyUser`/`recordActivity` helpers in
  `app/_lib/platform-events.ts` (best-effort — a notification/activity
  failure never blocks the action that triggered it).
  - Notifications: on being added to a project (`inviteProjectMember`), and
    to every other project member (never the publisher) on a successful
    publish (`publishCommittedDraft`, `publishAllCommittedDrafts`).
  - Activity records: project created/archived/restored/deleted, member
    invited/removed, and publish events (both single-file and publish-all).
- [x] Added tests: `data-contracts.test.ts` (per-contract filtering,
  including the private-project visibility rule and draft-content
  exclusion), `portability.test.ts` (export shape, additive import with id
  remapping and orphaned-draft skipping, and all three delete branches —
  non-owner removal, ownership transfer, sole-member hard-delete).

Acceptance criteria:

- Data contract outputs never expose private draft content or private repo
  metadata beyond the SPEC visibility rules.
- Export/import can restore projects and drafts additively.
- User deletion leaves no user-scoped secrets or drafts behind.

Verification:

- `pnpm typecheck` and `pnpm test` (16 files / 87 tests in the plugin) pass.

## v0.2 Rich Text, Jekyll, Images

### ✅ PLW-011 Add Rich Text Markdown Editor

**Spec refs:** PLW-26.

**Status:** ✅ Complete — substantially fulfilled by PLW-024 (see the writer-first
UI redesign's phase 6). Image insertion is the one acceptance-criteria item not
yet covered; that's tracked separately under PLW-013 since no upload capability
exists yet.

Add a WYSIWYG mode powered by Tiptap, ProseMirror, or equivalent.

Implementation requirements:

- Rich text mode outputs clean CommonMark Markdown.
- Raw HTML is not stored in content files.
- Users can switch between Markdown and rich text modes without data loss for
  supported syntax.
- Unsupported Markdown constructs are preserved or clearly shown as unsupported.

Acceptance criteria:

- Non-technical users can write headings, links, lists, emphasis, blockquotes,
  code blocks, and images without writing Markdown syntax.
- Markdown output remains stable across edit/save/reopen cycles.

Verification:

- Add editor serialization tests and interaction tests.
- Run typecheck and tests.

### ✅ PLW-012 Add Jekyll Adapter After Astro

**Spec refs:** PLW-27.

**Status:** ✅ Complete.

Implement Jekyll content discovery without changing core file listing or editor
logic.

Progress as of 2026-07-11:

- [x] `app/_lib/ssg-adapters.ts`: added `JekyllAdapter` implementing
  `SsgAdapter`, restricted to `_posts/`, `_pages/`, and `_drafts/` (the three
  directories named in this task's spec; other underscore-prefixed custom
  Jekyll collections are intentionally out of scope for v0.2). Supports `.md`
  and `.markdown` extensions. Collection names map directly from the
  directory (`_posts` → `posts`, etc.).
- [x] Extracted a shared `stripPrefix` helper (used by both `AstroAdapter` and
  `JekyllAdapter`) that treats an empty `pathPrefix` as "repository root" —
  fixing a latent bug where `AstroAdapter` couldn't handle a root-level
  prefix, previously unreachable since nothing produced an empty prefix.
- [x] `project-rules.ts`: added `jekyll` to `SSG_TYPES`, and gave
  `normalizePathPrefix` an explicit `.` → `''` (repository root) convention —
  needed because Jekyll's `_posts/`/`_pages/`/`_drafts/` live at the repo
  root rather than under a nested content directory like Astro's
  `src/content/`, and an empty text input can't be distinguished from
  "untouched" (which still defaults to `src/content`, the common case).
- [x] Added `jekyll` to the SSG select in `NewProjectDialog.tsx` and the
  project settings page; added a "Use . if your posts live at the repository
  root" hint to both pathPrefix fields.
- [x] No changes needed to `schema-rules.ts` — frontmatter schema inference
  is already SSG-agnostic (operates on raw frontmatter data, not file
  layout); added Jekyll-shaped test coverage (`layout`, `categories`, `tags`,
  a space-separated `date` with UTC offset) to confirm it infers correctly
  without any Jekyll-specific code.
- [x] Added 8 new adapter test cases (discovery, collection inference,
  root vs. non-root prefix, extension/collection-dir rejection) and 2 new
  `project-rules.test.ts` cases for the `.` convention and jekyll acceptance;
  fixed a stale test that had asserted `jekyll` was unsupported.
- [x] Live-verified end-to-end against a real public Jekyll repository
  (`barryclark/jekyll-now`): connected with content folder `.` and SSG type
  Jekyll, correctly discovered the one real post under `_posts/`, grouped
  it under the "posts" collection, and opened it in the editor with
  Jekyll-style frontmatter (`layout`, `title`) correctly rendered as
  schema fields — zero console errors.

Acceptance criteria:

- A Jekyll repo can be connected, synced, browsed, edited, and published through
  the existing core workflow.
- Core provider and editor code does not branch on Jekyll-specific behavior.

Verification:

- `pnpm test` (plugin: 138/138), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, and a full `pnpm build` all pass.
- Live-verified in the dev server against a real public Jekyll repository
  (see above).

### ✅ PLW-013 Add Image Upload

**Spec refs:** PLW-28.

**Status:** ✅ Complete.

Allow users to upload images into the git repository from the editor.

Progress as of 2026-07-11:

- [x] `app/_db/schema.ts`: added `imageUploadPath` (default `public/images`)
  to `plainwriteProjects`; migration `0001_add_image_upload_path` (sqlite +
  postgres, journals updated). `project-rules.ts`'s new
  `normalizeImageUploadPath` mirrors `normalizePathPrefix` but has no
  `.`-root convention — a repo-root image path would collide with the
  repo's other top-level files, so root isn't a meaningful choice for it.
  Exposed as an "Image upload path" field on the site settings page; not
  added to the "Connect a site" wizard, since the schema default covers
  project creation and keeping the wizard to its existing fields avoids
  scope creep there.
- [x] `app/_lib/image-rules.ts` (new, pure functions): `validateProjectImage`
  (JPEG/PNG/WebP/GIF, 5 MB cap — SVG deliberately excluded, since inline SVG
  can carry script content), `slugifyImageBasename`, `buildImageUploadFilePath`
  (always appends a short random suffix so same-name uploads never collide —
  simpler and race-free than checking remote existence first), and
  `buildImageReferenceUrl` (strips a leading `public/` — Astro's, and this
  task's default `imageUploadPath`'s, serve-at-root convention; other
  `imageUploadPath` values are referenced as-is, since there's no reliable
  way to know a given SSG's serving rules beyond that — a best-effort
  default the user can freely edit afterward, documented as such in the
  function's docblock).
- [x] `git-providers.ts`: `publishFile`'s `file` param gained an optional
  `contentEncoding?: 'utf8' | 'base64'`. Uploaded image bytes are binary, and
  re-running already-base64 content through the existing
  `Buffer.from(content, 'utf8').toString('base64')` path would corrupt it —
  `'base64'` skips that re-encode and sends the bytes as-is.
- [x] `actions.ts`: new `uploadProjectImage` action. Uploads straight to the
  git repository (not staged as a draft — binary assets don't fit the
  text-draft/conflict-review model the rest of this file uses) via the same
  `resolveGitHubCredential` → `provider.publishFile` →
  `insertPublishEvent`/`notifyAndLogPublish` → `classifyPublishFailure`
  pipeline as a normal text publish, so branch protection and provider
  failures get the same classification and audit trail for free. Returns a
  new `ImageUploadResult` type (`url`/`alt` for the rich-text editor's
  `setImage` command, `markdown` for the raw-textarea insertion — the two
  modes need the reference in different shapes).
- [x] `RichTextBodyEditor.tsx`: added `@tiptap/extension-image` (bundled
  markdown serialization already exists in `tiptap-markdown`'s default
  extension set, verified by reading its source — no custom serializer
  needed) and an `onEditorReady` callback that hands the live `Editor`
  instance up to `MarkdownEditor.tsx`, since the shared upload button lives
  outside this component (it needs to work the same way in Markdown mode).
- [x] `MarkdownEditor.tsx`: a single "Upload image" button next to the
  Write/Markdown/Preview `SegmentedControl` (disabled in Preview mode, since
  there's nowhere to insert), backed by a hidden file input. On success,
  Write mode calls `richEditor.chain().focus().setImage(...).run()`; Markdown
  mode splices the Markdown reference into the raw textarea at
  `selectionStart`/`selectionEnd`. The textarea's DOM node is captured as a
  side effect of the `onChange`/`onFocus` handlers it already has wired,
  rather than adding a `ref` prop to `CodeTextarea` (`packages/ui`, in the
  separate platform repo — out of scope for a plugin-repo task, and this
  plugin-local capture avoids needing it at all).
- [x] `portability.ts`: added `imageUploadPath` to project export/import for
  round-trip fidelity, matching every other project column.
- [x] Added `image-rules.test.ts` (14 cases: validation, slugify, path
  building, reference URL) and `actions-upload-image.test.ts` (6 cases:
  success, unsupported type, oversized file, missing credential, provider
  failure, no file selected — all against a mocked provider).
- [x] Live-verified in the dev server: the "Upload image" button and hidden
  file input render correctly next to the mode switcher; a real file
  selection (via a synthetic `DataTransfer`, since there's no way to drive
  the native OS file picker) correctly reached `uploadProjectImage` and
  surfaced its inline error ("Connect a GitHub token before uploading
  images.") in the UI with zero console errors — this session's test
  projects are all public demo repos with no real write credential, so the
  actual-GitHub-write success path isn't live-verified end-to-end (same
  constraint noted in PLW-022); it's covered by the mocked action test
  instead. The new "Image upload path" settings field also renders
  correctly with its default value.

Acceptance criteria:

- A valid image can be uploaded and referenced in Markdown.
- Invalid file types, oversized files, conflicts, and provider failures are
  handled with clear errors.

Verification:

- `pnpm test` (plugin: 156/156), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, and a full `pnpm build` all pass.
- Live-verified in the dev server (see above).

## v0.3 Collaboration And Conflict Resolution

### PLW-014 Add Advisory File Locks

**Spec refs:** PLW-29.

Show project members who is currently editing a file.

Implementation requirements:

- Add advisory lock storage with project, file path, user, and expiry timestamp.
- Create or refresh lock when a user opens or actively edits a file.
- Expire locks automatically after configurable idle timeout.
- Show lock/presence indicator in the file listing and editor.
- Locks are advisory only; they do not prevent other users from editing.

Acceptance criteria:

- Multiple users can see current edit presence for shared project files.
- Expired locks disappear without manual cleanup.

Verification:

- Add tests for lock creation, refresh, expiry, and visibility filtering.
- Run typecheck and tests.

### PLW-015 Add Conflict Resolution UI

**Spec refs:** PLW-30, Open questions staged deletion conflicts.

Let users resolve remote-vs-local conflicts without a git client.

Implementation requirements:

- When PLW-23 detects a conflict, fetch the current remote version.
- Show side-by-side diff of remote content and local committed draft.
- Support keep local, keep remote, and cancel.
- Treat delete-vs-update conflicts as a distinct conflict type.
- Keep local performs an explicit force-overwrite action only after confirmation.
- Keep remote discards the local draft after confirmation.

Acceptance criteria:

- Users can resolve ordinary edit conflicts and delete-vs-update conflicts in UI.
- Force overwrite is never implicit.

Verification:

- Add tests for conflict type detection and resolution actions.
- Add interaction tests for the diff UI.
- Run typecheck and tests.

### PLW-016 Add Custom SSG Adapter

**Spec refs:** PLW-31.

Support non-Astro/non-Jekyll static site generators through configurable content
paths and extensions.

Implementation requirements:

- Add `CustomAdapter` implementing `SsgAdapter`.
- Allow project owners to configure path prefix and file extensions.
- Use flat listing or simple path-based grouping when no SSG convention is
  known.
- Ensure custom adapter does not require core file listing or editor changes.

Acceptance criteria:

- Hugo, Eleventy, Hexo, or similar repositories can be configured through custom
  path and extension settings.
- Custom adapter projects can sync, edit, and publish through the existing
  workflow.

Verification:

- Add adapter unit tests for representative custom trees.
- Run typecheck and tests.

## v1.0 Stabilization

### PLW-017 Harden Security, Privacy, And Abuse Cases

**Spec refs:** Credential encryption, Access control, Data contracts,
Portability and deletion.

Perform a focused security pass before declaring Plainwrite stable.

Progress:

- [x] Content path-scope enforcement (pathPrefix + extension + `..`
  validation across `getEditorState`, `upsertDraft`, `publishCommittedDraft`)
  pulled forward and completed ahead of this task — see
  `docs/adhoc/plainwrite-code-review-and-fix-plan.md` P2-1.

Implementation requirements:

- Verify no credentials appear in logs, database tables, exports, activity,
  notifications, or client payloads.
- Review SSRF protections for self-hosted `provider_url`.
- Review OAuth callback and redirect validation.
- Review Markdown preview sanitization and rich text serialization.
- Review private metadata visibility and data contract filtering.
- Review delete/export behavior for user-scoped data and project-owned history.

Acceptance criteria:

- Security review findings are fixed or explicitly tracked as release blockers.
- Plugin meets Sovereign architecture rules for plugin boundaries and secrets.

Verification:

- Run the Sovereign security review checklist.
- Run typecheck, tests, manifest validation, and plugin boundary validation.

### PLW-018 Document Plainwrite As Reference Plugin

**Spec refs:** v1.0 stable.

Document Plainwrite for operators, users, and plugin developers.

Implementation requirements:

- Add operator setup docs for GitHub OAuth provider config and PAT fallback.
- Add user docs for creating projects, connecting credentials, editing, and
  publishing.
- Add developer docs showing Plainwrite as a reference for:
  - `sdk.secrets`.
  - `sdk.connections`.
  - `sdk.data`.
  - `sdk.portability`.
  - provider adapters.
  - sanitized previews.
- Document known limitations: direct publishing only in v0.1, branch protection
  failure behavior, and self-hosted OAuth limitations.

Acceptance criteria:

- A new operator can configure Plainwrite without reading source code.
- A plugin developer can identify reusable patterns for third-party API
  integration and runtime credentials.

Verification:

- Run docs format/check commands used by the repository.

### ✅ PLW-019 Writer-First UI Copy Pass

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 1 of 6.

**Status:** ✅ Complete.

Phase 1 of the writer-first UI redesign proposed in
`docs/adhoc/plainwrite-ui-redesign.md`: translate git/technical vocabulary to
plain language across every existing screen, with no layout or data-model
changes. See the doc's §3 jargon table and §8 phasing for the full plan.
Phases 2–6 (navigation restructure, new-post/publish flow, conflict review,
connect-a-site wizard, editor modes) landed as PLW-020 through PLW-024.

Progress as of 2026-07-10:

- [x] Added `app/_lib/copy.ts` — shared `formatProjectRole`,
  `formatMetadataVisibility`, `formatPostStatus` translations (project role →
  Reader/Writer/Owner, draft status → Writing/Ready to publish/Live on site,
  metadata visibility → plain phrases) so the mapping stays consistent across
  screens instead of drifting per-file.
- [x] Home (`app/page.tsx`, `NewProjectDialog.tsx`): "Projects" → "Your
  sites", empty state rewritten as an invitation, "New project" dialog →
  "Connect a site" with plain-language field labels.
- [x] Site dashboard (`app/[projectId]/page.tsx`): repository/setup card,
  actions panel, new-file panel, content list, work-area cards, and publish
  history all reworded (e.g. "Content files" → "Posts", "Drafts" → "Writing",
  "Publishing" → "Ready to publish", "Sync content" → "Check for updates").
- [x] Editor (`MarkdownEditor.tsx`, `editor/[...filePath]/page.tsx`): "Save
  draft" → "Save", "Mark ready" → "Ready to publish", "Discard draft" →
  "Discard changes"; raw base-revision SHA display replaced with a plain
  synced/new-post status; stale "stay local until a publishing task connects
  Git write-back" copy corrected (publishing has worked since PLW-007).
- [x] Settings (`settings/page.tsx`, `InviteMemberForm.tsx`): section
  headings and field labels reworded for owners ("GitHub credential" →
  "Publishing access", "Collection schemas" → "Content fields", "Members" →
  "People"); member/invite role options display Reader/Writer/Owner.
- [x] Sidebar (`PlainwriteSidebar.tsx`): "Projects"/"Content" → "Sites"/
  "Posts", "Back to projects" → "Back to sites".
- [x] No component-render tests existed to break (all existing tests cover
  `app/_lib/actions.ts` server logic); verified via `pnpm typecheck`,
  `pnpm lint`, `pnpm test` (18 files / 92 tests), `pnpm format:check`.

Acceptance criteria:

- No git/internal vocabulary (commit, sync, SHA, revision, repository,
  collection, credential) appears in a user-facing string reachable by a
  non-owner role, per the jargon table in the redesign doc.
- Underlying stored values (role strings, draft status strings, metadata
  visibility enum) are unchanged — this is a display-only pass.

Verification:

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (92/92), `pnpm format:check` all
  pass from the platform root.

### ✅ PLW-020 Navigation And Home Restructure

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 2 of 6.

**Status:** ✅ Complete.

Phase 2 of the writer-first UI redesign: site cards on both home states,
pipeline tabs on the site content home, and moving owner-only/setup content
(repository detail, setup checklist, publish history) off the daily view and
into settings. Builds on PLW-019's plain-language copy.

Progress as of 2026-07-10:

- [x] Extended `listProjects()` (`app/_lib/actions.ts`) to batch-compute
  per-project `writingCount`/`readyCount` (current user's own local drafts),
  `liveCount` (file-cache size, an approximation of posts already on the
  site), and a `needsAttention` flag (credential `status === 'needs_reauth'`)
  — three queries total via `Promise.all`, not per-project, so the site list
  stays a fixed number of round trips regardless of project count.
- [x] Home (`app/page.tsx`): replaced the flat project list with a
  `SiteCard` grid showing a health dot, the "N writing · N ready · N live"
  pipeline summary (or the plain-language attention message when a
  credential needs reconnecting), and role. Archived sites collapsed to a
  compact list below. Empty state now also addresses invited writers who
  won't create a site themselves.
- [x] Site content home (`app/[projectId]/page.tsx`): added pipeline tabs
  (All / Writing / Ready to publish / Live on site) via `NavTabs` and a
  `?status=` query param, filtering the posts list — no client JS, server
  render only. Removed the repository detail card, setup checklist card,
  and the 4-card "Content/Writing/Ready to publish/People" grid (redundant
  with the tabs and with settings).
- [x] Settings (`settings/page.tsx`): added a "Publish history" panel
  (relocated from the dashboard, using the same `listPublishEvents`).
- [x] Added `formatPipelineSummary` to `app/_lib/copy.ts`.
- [x] Added `app/_lib/__tests__/actions-list-projects.test.ts` covering the
  new count/attention-flag aggregation.
- [x] Verified via `pnpm typecheck`, `pnpm lint`, `pnpm test` (19 files / 94
  tests), `pnpm format:check`, and a full `pnpm build` (webpack compiles
  `/plainwrite`, `/plainwrite/[projectId]`,
  `/plainwrite/[projectId]/editor/[...filePath]`, and
  `/plainwrite/[projectId]/settings` with no errors) — live browser
  verification was blocked this session by an unrelated Docker container
  already bound to port 3000.

Acceptance criteria:

- The home page and site content home carry no git/technical vocabulary
  beyond what PLW-019 already established.
- Per-project pipeline counts and the credential-attention flag are correct
  for multi-project users (covered by the new test).

Verification:

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (94/94), `pnpm format:check`,
  `pnpm build` all pass from the platform root.

### ✅ PLW-021 New Post And Publish Flow

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 3 of 6.

**Status:** ✅ Complete.

Phase 3 of the writer-first UI redesign: a title-first "New post" dialog
replacing the old Collection+Filename form, and a publish confirmation
dialog listing what's about to go live in place of the bare "Publish all"
button. Builds on PLW-019/PLW-020.

Progress as of 2026-07-10:

- [x] `NewPostDialog.tsx` (new): title field first; filename auto-derived
  from the title via slugify, shown as a muted "Will be saved as … ·
  change" preview with a manual-override escape hatch; section picker
  renders as clickable pills sourced from the project's existing
  collections (falls back to a free-text field when there are none yet).
- [x] `createContentFile` now accepts the raw title and carries it through
  to the editor as a one-time `?title=` query param (never persisted) so a
  brand-new post's frontmatter seeds with what the writer actually typed
  instead of reverse-engineering Title Case from the slug.
  `getEditorState`/`defaultFrontmatterYaml`/`defaultMarkdownTemplate` gained
  an optional `title` parameter for this.
- [x] Editor page header now shows the post's real frontmatter `title`
  (parsed via `parseMarkdownDocument`) instead of the raw file path.
- [x] **Fixed a real gray-matter cache bug** found while testing the above:
  `matter(input)`/`matter.stringify(...)` called with no `options` argument
  memoize by content string, and the cached entry is the *same object* the
  parser mutates in place — a second call with byte-identical input
  (e.g. saving the same title twice, or two new posts started with the same
  title) returned a stale/empty result instead of re-parsing. Every
  `matter()`/`matter.stringify()` call site in `editor-rules.ts` and
  `schema-rules.ts` now passes `{}` to opt out of the cache. This was
  pre-existing and would have silently corrupted the live structured
  frontmatter editor (which calls `serializeStructuredFrontmatter` on every
  field edit) after the second identical save in a session, not just the
  new title-seeding path. Regression tests added.
- [x] `PublishAllForm.tsx` rewritten: "Put N live" now opens a confirmation
  Dialog listing the ready-to-publish posts by filename, with the
  skip-conflicts checkbox and the actual Publish button moved inside it.
  Inline `ActionResult` errors render inside the dialog (kept open on
  failure); the dialog auto-closes on success, and a success message
  (e.g. noting skipped conflicts) surfaces below the trigger button. No true
  conflict preflight yet — that is phase 4 ("Conflict review").
- [x] Added regression tests: `actions-create-content-file.test.ts` (title
  query-param encoding, filename requirement), new cases in
  `actions-editor-lifecycle.test.ts` (new-file title seeding vs. slug
  fallback), and gray-matter cache-repro cases in `editor-rules.test.ts`.
- [x] **Live-verified** end to end via the dev server (not just automated
  checks, since this phase touches interactive client components):
  registered/reused a test account, opened "New post", typed a title
  containing a colon (`Why: We Moved to a Static Site`) to specifically
  exercise the YAML-quoting fix, confirmed the redirect URL and the
  editor's frontmatter/header both round-tripped the title exactly, saved
  and confirmed the status label updated correctly, and opened the publish
  confirmation dialog through to its (expected, no-token) inline error
  state without any crash or state loss.
  - **Found and fixed a second live-only bug** during this pass: a
    brand-new, never-saved post showed "Live on site" as its status
    (`formatPostStatus('unmodified')` from PLW-019's copy pass, correct for
    an existing synced post but wrong for a new one with no draft yet).
    Fixed via a `baseSha`-aware `editorStatusLabel` helper in
    `MarkdownEditor.tsx` that shows "New post" instead when
    `status === 'unmodified' && baseSha === null`.

Acceptance criteria:

- A writer can create a post by typing a title alone; the filename and
  frontmatter title are both derived correctly, including titles containing
  YAML-significant characters.
- Publishing shows what will go live before it happens, and holds back /
  explains conflicts without crashing.

Verification:

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (102/102), `pnpm format:check`,
  and a full `pnpm build` all pass from the platform root. Live-verified in
  the browser (see above) — the first phase of this epic where that was
  possible this session.

### ✅ PLW-022 Conflict Review

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 4 of 6.

**Status:** ✅ Complete (single-file publish flow).

Phase 4 of the writer-first UI redesign: when a publish conflict is
detected (the site's copy of a file changed since the draft's base
revision), show a two-version comparison instead of a bare error string,
with three actions mapped to real operations. Builds on PLW-019/020/021.

Progress as of 2026-07-10:

- [x] `app/_lib/conflict-rules.ts` (new): `diffParagraphs` — a deliberately
  crude positional paragraph diff (not a real LCS/Myers algorithm; see the
  file's docblock for why that's the right tradeoff here) marking which
  paragraphs differ between two markdown bodies.
- [x] `getConflictComparison` (new, read-only): fetches the current local
  draft plus a fresh copy of what's on the site right now (not the
  file-cache, which can itself be stale) for the review screen.
- [x] `refreshDraftBase` (new): "Keep editing mine" — moves the draft's
  recorded base revision forward to the site's current sha without
  touching draft content or publishing, so the next normal publish attempt
  no longer conflicts on a stale sha.
- [x] `publishCommittedDraft` gained a `force` form field: "Publish mine
  anyway" skips the conflict check and adopts whatever sha is on the site
  right now as the base for the write — GitHub's contents API needs the
  *current* blob sha to accept an update, so force-publish still has to
  look that up, it just doesn't refuse to proceed on a mismatch.
- [x] `ConflictReviewDialog.tsx` (new): two-column comparison ("Version on
  the site" / "Your version") with changed paragraphs highlighted; the
  three actions are "Use the site's version" (existing `discardDraft`),
  "Keep editing mine" (`refreshDraftBase`), and "Publish mine anyway"
  (`publishCommittedDraft` with `force=true`). Reachable via a "Review
  changes" link that appears only when the inline publish error is
  actually a conflict (`Conflict:` prefix — `assertNoPublishConflict`'s one
  and only message convention).
- [x] Scoped to the single-file editor publish flow only.
  `PublishAllForm`'s "held back" conflicts (skip-conflicts checkbox) still
  resolve by skip-and-report via the existing `ActionResult` message, not a
  per-file review — extending review there is a reasonable follow-on, not
  done here.
- [x] Added `actions-conflict-review.test.ts` (10 cases: comparison
  fetch incl. remote-missing, base-sha refresh incl. remote-missing,
  ordinary conflict detection, force-publish sha adoption, force-publish
  against a since-deleted remote) and `conflict-rules.test.ts` (5 cases for
  the diff function).
- [x] Live-verified the non-regression path in the dev server (editor loads
  with the new props, "Publish" still shows the expected non-conflict error
  with no spurious "Review changes" link). A genuine remote conflict needs
  push access to a real GitHub repo, which this session's environment
  doesn't have — the conflict-detection and force-override logic itself is
  covered by the automated tests instead.

Acceptance criteria:

- A publish conflict shows what changed instead of a bare error string.
- All three review actions correspond to real, tested server operations;
  none of them can leave the draft or the site in an inconsistent state.

Verification:

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (117/117), `pnpm format:check`,
  and a full `pnpm build` all pass from the platform root.

### ✅ PLW-023 Connect-A-Site Wizard

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 5 of 6.

**Status:** ✅ Complete (public-repo detection; private repos fall back to
manual entry).

Phase 5 of the writer-first UI redesign: turn "New project" into a two-step
"Connect a site" wizard that detects the repository's default branch and
likely content path before asking the user to confirm anything, instead of
asking for branch/path up front. Builds on PLW-019/020/021/022.

Progress as of 2026-07-11:

- [x] `app/_lib/git-providers.ts`: added `detectGitHubRepository` (default
  branch lookup) and `detectGitHubRepositoryFiles` (recursive tree listing),
  both unauthenticated — credentials are stored per-project
  (`plainwrite_credentials` is keyed on `(projectId, userId)`) and so cannot
  be attached before a project row exists. This scopes detection to public
  repositories; private repos fall back to the existing manual-entry +
  post-creation credential-connection flow, an intentional adaptation of the
  proposal's flow to this constraint.
- [x] `app/_lib/detection-rules.ts` (new, pure functions): `suggestPathPrefix`
  (prefers `src/content/`, else the common ancestor directory of all markdown
  files found) and `countPostsUnderPrefix`.
- [x] `app/_lib/actions.ts`: new `detectRepository` action wraps URL parsing +
  detection + prefix suggestion + post count behind a single call the wizard
  step can await; returns a friendly "couldn't find that repository — or it's
  private" message on failure rather than a raw API error. `createProject`
  itself is unchanged.
- [x] `NewProjectDialog.tsx` rewritten into a 2-step wizard (`detect` →
  `confirm`): step one takes a repository URL and calls `detectRepository`,
  auto-filling name/branch/pathPrefix on success and advancing; on failure (or
  via an explicit "Continue manually" escape hatch) the user lands on the
  original single-step form fields. Step two shows a "Found it — N posts in
  `<prefix>`" confirmation when detection succeeded.
- [x] Fixed a CSS specificity bug found while styling the confirmation note:
  `.header p` (0,1,1) was silently beating `.detectionNote` (0,1,0) regardless
  of source order; resolved with `.header p.detectionNote` (0,2,1).
- [x] Added `detection-rules.test.ts` (8 cases) and
  `actions-detect-repository.test.ts` (4 cases, GitHub calls mocked).
- [x] Live-verified end-to-end against a real public repository
  (`satnaing/astro-paper`): detected branch `main`, suggested `src/content`,
  counted 19 real markdown posts, auto-filled "Astro Paper" as the site name,
  and successfully created the project with all 19 posts synced and grouped
  by collection.

Acceptance criteria:

- Connecting a public GitHub repository requires only a URL; branch and
  content path are detected and pre-filled, not asked for blind.
- Private repos and detection failures degrade gracefully to the previous
  manual-entry form, with no dead end.

Verification:

- `pnpm test` (plugin: 129/129), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, and a full `pnpm build` all pass.
- Live-verified in the dev server against a real public GitHub repository
  (see above).

### ✅ PLW-024 Editor Modes (Write / Markdown / Preview)

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` (proposal), phase 6 of
6.

**Status:** ✅ Complete.

Phase 6 of the writer-first UI redesign, and the last phase in the plan:
replace the always-on raw-markdown textarea with three switchable body modes
— Write (WYSIWYG rich text via TipTap), Markdown (the original raw textarea,
unchanged), and Preview (the existing sanitized rendered-HTML view, promoted
from an always-visible side panel to a mode). Builds on
PLW-019/020/021/022/023. This also substantially fulfills the longer-standing
PLW-011 backlog item (rich text markdown editor); image insertion remains
tracked separately under PLW-013 since no upload capability exists yet.

Progress as of 2026-07-11:

- [x] Added `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`,
  `@tiptap/starter-kit`, and `tiptap-markdown` as plugin dependencies
  (`@tiptap/starter-kit` v3 already bundles link support, so no separate
  `@tiptap/extension-link` dependency was needed).
- [x] `RichTextBodyEditor.tsx` (new): the Write-mode editor. Uses
  `immediatelyRender: false` for Next.js SSR safety, and `Markdown.configure({
  html: false })` — a deliberate security choice (not the library default) so
  raw HTML in a post's source is never parsed into live DOM nodes, matching
  `renderSafeMarkdownPreview`'s existing XSS-safety posture. Toolbar covers
  bold, italic, H1/H2, bullet/numbered lists, blockquote, link
  (`window.prompt`-based), and inline code.
- [x] `MarkdownEditor.tsx`: added a `bodyMode` (`write` / `markdown` /
  `preview`) `SegmentedControl` above the body panel; the previously
  always-visible sidebar preview panel was removed in favor of Preview being
  one of the three modes. Mode preference persists to `localStorage`,
  hydration-safe per the CLAUDE.md pattern (state initializes to `'write'` on
  both server and client; the real stored value is only read in a
  `useEffect` after mount).
- [x] Mode switches unmount/remount `RichTextBodyEditor` rather than
  reactively syncing it: TipTap's `content` prop is only read once at mount,
  so switching away from Write mode fully destroys the editor instance and
  switching back remounts fresh from whatever markdown is current at that
  moment — correct bidirectional sync without a manual sync effect.
- [x] Live-verified round-trip fidelity in the dev server against a real
  post: typed a new sentence and toggled formatting in Write mode, confirmed
  the exact edit and markdown syntax (`*emphasis*`, `## heading`) appeared
  correctly in Markdown mode, confirmed correct rendered HTML in Preview
  mode, then switched back to Write and confirmed no data loss — with zero
  console errors throughout.

Acceptance criteria:

- Non-technical users can write headings, links, lists, emphasis, and
  blockquotes without writing Markdown syntax.
- Markdown output remains stable across mode switches (no data loss for
  supported syntax).

Verification:

- `pnpm test` (plugin: 129/129), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, and a full `pnpm build` all pass.
- Live-verified in the dev server: Write → Markdown → Preview → Write
  round-trip with a real edit, confirmed byte-for-byte in each mode, zero
  console errors.

### ✅ PLW-025 Remove The Plainwrite Sidebar

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` §4 (screens).

**Status:** ✅ Complete.

The redesign wireframes (§4) show every screen as a single full-width
panel with in-panel navigation — none has a Plainwrite-local side rail. The
`PlainwriteSidebar` shipped during the earlier navigation work (PLW-020) was
an implementation deviation: it nested a second sidebar inside the runtime
shell's own app rail, duplicated context already in each page's header
(site name, repo, editing path), and on mobile stacked ~500px of
"Back to sites / Current site / Posts / Settings / Editing" chrome above the
actual work surface. This brings the implementation in line with the spec.

Progress as of 2026-07-11:

- [x] Deleted `PlainwriteSidebar.tsx` / `.module.css`; `layout.tsx` now
  renders just the content `<main>` (the runtime shell already provides the
  top-level app rail). Removed the now-dead `getProjectNavigation` action
  (the sidebar was its only caller).
- [x] Replaced the sidebar's navigation with a one-level-up breadcrumb —
  `BackLink` (new, plugin-local: the muted "← …" affordance the editor
  wireframe shows top-left). Content home → "Back to sites"; settings →
  "Back to posts"; the editor keeps its existing "Back to posts". Kept
  plugin-local rather than in `@sovereignfs/ui` for now (a thin styled
  `Link`; a back/breadcrumb primitive is a reasonable future DS candidate,
  but this avoids a cross-repo change to ship the cleanup).
- [x] Centered each page's existing `max-width: 1040px` column
  (`margin-inline: auto`) now that the freed sidebar width would otherwise
  leave content hugging the left on wide screens; the editor stays
  full-width (its two-column layout wants the room).
- [x] Live-verified in the dev server at desktop and mobile widths: sidebar
  gone on Sites / content home / settings / editor, both back links
  navigate correctly, mobile leads straight with the content instead of
  stacked nav, zero console errors.

Verification:

- `pnpm test` (plugin: 156/156), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, and a full `pnpm build --force` all pass.
- Live-verified across screens and breakpoints (see above).

### ✅ PLW-026 Remove The Stale Provider Chip From The Sites Header

**Spec refs:** `docs/adhoc/plainwrite-ui-redesign.md` §4 (screens).

**Status:** ✅ Complete (patch — UI polish).

The Sites header carried a hardcoded `Badge` reading "GitHub + Astro" next
to the "+ Connect a site" button. It went stale when the Jekyll adapter
landed (PLW-012) — the plugin now supports Astro *and* Jekyll — and it was
never in the wireframe (§4 shows title + description + one button, no
provider chip). It also read as a status badge (`variant="status"`) beside
the primary action, crowding the top-right. Removed it; the button now
stands alone as the page's single primary CTA. Supported providers/SSGs
are a connect-time concern that already surface contextually in the
"Connect a site" wizard, so no information is lost. The button itself is
unchanged — it's the standard design-system `Button md` primary (42px,
14px/600), consistent with every other primary action.

Verification: `pnpm test` (156/156), `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, and a full `pnpm build` all pass. Live-verified the
header on the Sites page (chip gone, button reads cleanly), zero console
errors.

## Future Backlog

These items are intentionally outside v1.0 unless reprioritized.

- Pull-request or merge-request based publishing for protected branches.
- Bring-your-own OAuth app configuration for self-hosted GitLab/Gitea projects.
- GitLab provider implementation.
- Gitea/Forgejo provider implementation.
- Hugo, Eleventy, and Hexo first-class adapters.
- New Astro collection creation.
- Configurable Publish All commit-message strategies.
- Assistant/tool contracts for confirmed create, edit, and publish actions.
- Optional signed commit support where providers expose it.
