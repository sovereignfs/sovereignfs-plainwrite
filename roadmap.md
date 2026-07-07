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

### PLW-004 Implement GitHub PAT Credentials With Secret Vault

**Spec refs:** PLW-06, PLW-07, OAuth flow, Credential encryption.

**Status:** Implementation complete; credential tests still pending.

Progress as of 2026-07-07:

- [x] Added project settings UI for each editor/owner to connect a GitHub PAT.
- [x] Validates the PAT against GitHub and resolves the provider login before
  storing metadata.
- [x] Stores token material only with `sdk.secrets`; Plainwrite stores
  `secret_ref`, provider, `auth_type`, provider login, status, and sanitized
  error metadata.
- [x] Reconnecting creates or rotates the platform vault secret without exposing
  the token.
- [x] Disconnect deletes the platform vault secret and marks the credential
  disconnected without deleting drafts.
- [x] Sync and editor file reads use the current user's connected token when
  available and require it for private repositories.
- [x] Documented required GitHub token contents read/write permissions in UI
  help copy and README.
- [ ] Add tests proving token values are not written to plugin tables.

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

### PLW-006 Implement Editor, Drafts, And Sanitized Preview

**Spec refs:** PLW-11 through PLW-20.

**Status:** Partial. Existing/new-file editing, local draft state, raw YAML
frontmatter editing, and sanitized preview are implemented; structured schema
fields, staged deletion, autosave, and remote publish remain.

Progress as of 2026-07-07:

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
- [ ] Add staged deletion drafts with `content: null`.
- [ ] Parse and serialize frontmatter with `gray-matter` or a schema-aware YAML
  parser once structured fields are implemented.
- [ ] Add structured frontmatter fields and raw YAML toggle.
- [ ] Add autosave after idle typing.
- [ ] Add editor lifecycle integration tests.

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

### PLW-010 Add Data Contracts, Portability, Activity, And Notifications

**Spec refs:** Current platform refresh, SDK dependencies, Data contracts,
Portability and deletion.

Expose platform integrations after the core project workflow exists.

Implementation requirements:

- Implement read-only data contracts:
  - `plainwrite.projects` v1.
  - `plainwrite.content-index` v1.
  - `plainwrite.drafts` v1 metadata only.
- Enforce consent and project visibility rules for data contract reads.
- Implement export/import/delete participation for projects, memberships, file
  cache metadata, draft content, schema settings, and publish history.
- Exclude credentials from export; include credential metadata only when useful
  for reconnect prompts.
- Implement user deletion behavior: delete user credentials and drafts, remove or
  transfer owned projects, preserve remote git history.
- Emit notifications for share and publish events.
- Emit activity records for project and publish events.

Acceptance criteria:

- Data contract outputs never expose private draft content or private repo
  metadata beyond the SPEC visibility rules.
- Export/import can restore projects and drafts additively.
- User deletion leaves no user-scoped secrets or drafts behind.

Verification:

- Add tests for data contract filtering, export/import, and user deletion.
- Run typecheck and tests.

## v0.2 Rich Text, Jekyll, Images

### PLW-011 Add Rich Text Markdown Editor

**Spec refs:** PLW-26.

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

### PLW-012 Add Jekyll Adapter After Astro

**Spec refs:** PLW-27.

Implement Jekyll content discovery without changing core file listing or editor
logic.

Implementation requirements:

- Add `JekyllAdapter` implementing `SsgAdapter`.
- Scan `_posts/`, `_pages/`, and `_drafts/`.
- Infer collection names from Jekyll directory conventions.
- Add `jekyll` to project creation SSG type options.
- Add Jekyll-specific frontmatter schema inference coverage.

Acceptance criteria:

- A Jekyll repo can be connected, synced, browsed, edited, and published through
  the existing core workflow.
- Core provider and editor code does not branch on Jekyll-specific behavior.

Verification:

- Add adapter unit tests with sample Jekyll trees.
- Run typecheck and tests.

### PLW-013 Add Image Upload

**Spec refs:** PLW-28.

Allow users to upload images into the git repository from the editor.

Implementation requirements:

- Add configurable project image upload path, default `public/images/`.
- Validate file type and size before upload.
- Upload image through the provider adapter using the current user's credential.
- Insert Markdown image reference at the editor cursor position.
- Record publish events for uploaded files.
- Respect branch protection and provider failure behavior from publish tasks.

Acceptance criteria:

- A valid image can be uploaded and referenced in Markdown.
- Invalid file types, oversized files, conflicts, and provider failures are
  handled with clear errors.

Verification:

- Add upload validation tests and provider mock tests.
- Run typecheck and tests.

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
