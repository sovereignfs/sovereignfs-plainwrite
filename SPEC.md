# Plainwrite

**Version:** 0.3\
**Date:** June 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sovereign Plainwrite plugin — the single source of truth for its manifest, access model, data model, and build plan.\
**Status:** Draft

---

Plainwrite is a git-backed content editor for static site generators — a
self-hosted alternative to Netlify CMS / Decap CMS. It lets non-technical users
create, edit, and publish Markdown content in git-hosted repositories without
needing to know git. The plugin handles the entire workflow: connecting a repo,
browsing content files, editing with a structured frontmatter form or raw
Markdown, and pushing changes back.

**Design principles:** minimalism and reliability. Plainwrite does not try to
replicate a full headless CMS. It targets the specific, common case: a static
site whose content lives in Markdown files in a git repository, where someone
other than the developer needs to update content.

v0.1 targets GitHub and Astro. The architecture is built around two adapter
interfaces — **git provider** and **SSG** — so that GitLab, Gitea, Jekyll,
Hugo, and others plug in without touching core logic.

The plugin is `type: sovereign` — maintained in a separate external repository
and the primary reference implementation demonstrating credential management and
third-party API integration from within a Sovereign plugin.

## Current platform refresh (June 2026)

The platform now has a clearer path for this proposal's open gaps:

- User/project sharing should use the proposed user-directory SDK (RFC 0041).
- Runtime user credentials use `sdk.secrets` (RFC 0043) and connection metadata
  uses `sdk.connections` (RFC 0049). Plainwrite does not maintain its own
  long-term token encryption layer.
- Share/publish notifications can use `sdk.notifications`.
- Project metadata and content snippets can be exposed through read-only data
  contracts for approved consumers.
- Assistant/automation writes such as "create file" or "publish committed
  draft" should use plugin tool contracts (RFC 0047).
- The plugin should define export/import/delete behavior for projects, drafts,
  credentials, and cached file metadata.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Architecture: provider adapters + DB drafts](#architecture-provider-adapters--db-drafts)
- [Directory structure](#directory-structure)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [UI](#ui)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                               | `fs.sovereign.plainwrite`                                                                       |
| `name`                             | `Plainwrite`                                                                                    |
| `type`                             | `sovereign`                                                                                     |
| `runtime`                          | `native`                                                                                        |
| `routePrefix`                      | `/plainwrite`                                                                                   |
| `shell`                            | `default`                                                                                       |
| `adminOnly`                        | omitted (`false`)                                                                               |
| `icon`                             | `icon.svg`                                                                                      |
| `database`                         | `shared`                                                                                        |
| `permissions`                      | `auth:session`, `db:readWrite`, `notifications:send`, `data:provide`, `data:export`, `data:import`, `activity:write` |
| `data.provides`                    | `plainwrite.projects`, `plainwrite.content-index`, `plainwrite.drafts`                          |
| `connections.providers`            | `git.github` in v0.1; `git.gitlab`, `git.gitea`, and custom self-hosted providers after v0.1     |
| `repository`                       | `https://github.com/sovereignfs/sovereign-plainwrite`                                            |
| `compatibility.minPlatformVersion` | `0.18.2` — current platform baseline with `sdk.secrets`, `sdk.connections`, provider config, `sdk.data`, `sdk.directory`, portability, notifications, activity, and required UI primitives |

Proposed `manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.plainwrite",
  "name": "Plainwrite",
  "version": "0.1.0",
  "description": "A git-backed content editor for static site generators.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/plainwrite",
  "shell": "default",
  "icon": "icon.svg",
  "database": "shared",
  "permissions": [
    "auth:session",
    "db:readWrite",
    "notifications:send",
    "data:provide",
    "data:export",
    "data:import",
    "activity:write"
  ],
  "data": {
    "provides": [
      {
        "contract": "plainwrite.projects",
        "version": 1,
        "description": "Plainwrite projects visible to the current user."
      },
      {
        "contract": "plainwrite.content-index",
        "version": 1,
        "description": "File metadata and searchable snippets for explicitly shared projects."
      },
      {
        "contract": "plainwrite.drafts",
        "version": 1,
        "description": "Draft metadata for the current user; full content is never exposed by default."
      }
    ]
  },
  "connections": {
    "providers": [
      {
        "id": "git.github",
        "title": "GitHub",
        "callbackPath": "/oauth/github/callback",
        "scopes": ["repo", "read:user"],
        "config": {
          "public": {
            "clientId": {
              "label": "GitHub OAuth client ID",
              "env": "GITHUB_CLIENT_ID",
              "required": false
            }
          },
          "secrets": {
            "clientSecret": {
              "label": "GitHub OAuth client secret",
              "env": "GITHUB_CLIENT_SECRET",
              "required": false
            }
          }
        }
      }
    ]
  },
  "repository": "https://github.com/sovereignfs/sovereign-plainwrite",
  "compatibility": {
    "minPlatformVersion": "0.18.2"
  }
}
```

The repository name is `sovereignfs/sovereign-plainwrite`.

---

## Access control

Plainwrite is available to authenticated users who can launch installed plugins
under the platform's plugin access policy. The default platform scope is
`everyone`; administrators may later restrict the plugin to admins, selected
users, selected groups, or disable it entirely through the platform policy layer.
That platform-level gate is separate from project membership inside Plainwrite.

Access within the plugin is project-scoped:

- A user sees only projects they created or were invited to.
- **Roles:** `owner` (full control: settings, members, all file actions),
  `editor` (create, edit, commit, and publish files; cannot manage project
  settings or membership), and `viewer` (read-only access to visible project
  metadata and file listings; cannot fetch private file content without their own
  git credential).
- **Git provider credentials are per user, per project.** Each user who wants to
  commit or publish must authenticate with the project's git provider. The
  credential (OAuth token or PAT) determines the identity that appears on commits.
- **Private repository metadata is owner-controlled.** A user with no credential
  for a private repo project cannot read file content from the provider. They may
  view cached file listings only when the project owner has enabled cached
  metadata visibility for members without credentials; otherwise the UI prompts
  the user to connect their own credential before showing repository paths.

---

## Functional requirements

Requirements are versioned to their milestone. IDs are stable — never renumber
or reuse a PLW-\* id.

### v0.1 — Core (Astro + GitHub)

#### Project management

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-01 | Create a project: name, optional description, repository URL, git provider (v0.1: `github`), branch (default: `main`), path prefix (default: `src/content`), SSG type (v0.1: `astro`).                                                                                                                                                                                                                                                                                                                                        |
| PLW-02 | Edit project settings: name, description, branch, path prefix, and SSG type.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PLW-03 | Archive a project (soft-delete). Archived projects are hidden from the default listing but not destroyed. Hard delete is a separate, confirmation-required action.                                                                                                                                                                                                                                                                                                                                                            |
| PLW-04 | Share a project with other Sovereign instance users. Roles: `owner`, `editor`, and `viewer`. Owner can invite and remove members.                                                                                                                                                                                                                                                                                                                                                                                            |
| PLW-05 | Remove a member from a project. An owner cannot remove themselves if they are the only owner (transfer ownership or archive the project instead).                                                                                                                                                                                                                                                                                                                                                                             |
| PLW-06 | Authenticate with the project's git provider. For hosted providers with OAuth configured through `sdk.connections` (github.com in v0.1): a "Connect [Provider]" button initiates the OAuth 2.0 authorization code flow — the user authorizes in their browser and is redirected back; no token is ever entered manually. For providers without OAuth configured, the user enters a Personal Access Token manually. Tokens are stored in `sdk.secrets`; Plainwrite stores only the returned `secret_ref` and sanitized provider metadata. One credential per Sovereign user per project. |
| PLW-07 | Disconnect or re-authenticate a connected provider account. Disconnecting revokes the stored credential; any uncommitted drafts for the project are preserved.                                                                                                                                                                                                                                                                                                                                                                |
| PLW-08 | Sync file listing: fetch the repository's current file tree from the provider and refresh the local file cache. Sync is triggered manually (button) or automatically on project load if the cache is older than a configurable TTL. For private repositories, cached metadata visibility follows the project setting described in the access model.                                                                                                                                                                               |

#### File listing

| ID     | Requirement                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-09 | Display all Markdown files (`.md`, `.mdx`) under the configured path prefix, grouped by collection. For Astro, a collection is the immediate subdirectory under the path prefix. Files directly in the prefix are listed as "Root". |
| PLW-10 | Show a per-file status badge for the current user: **Unmodified**, **Draft** (saved, not committed), **Committed** (pending publish), **Conflict** (remote changed since last sync).                                                |
| PLW-11 | Create a new file: choose a collection, enter a filename (auto-slugified to lowercase kebab-case). Opens the editor with a blank template pre-populated with the collection's frontmatter fields.                                   |
| PLW-12 | Stage a file for deletion. The deletion is not pushed to the remote until Publish (PLW-21/PLW-22). A staged deletion is shown in the file listing with a "Pending delete" badge.                                                    |

#### Editor

| ID     | Requirement                                                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PLW-13 | Open a file for editing. If the current user has an active draft (status `draft` or `committed`) for the file, the draft is loaded. Otherwise file content is fetched from the provider and the `base_sha` is recorded.                                                                          |
| PLW-14 | Frontmatter editor — structured mode. Renders fields from the collection's inferred schema as typed inputs: text (string), date picker (date), number input (number), toggle (boolean), tag input (array of strings). Fields not present in the schema appear as a raw YAML block at the bottom. |
| PLW-15 | Frontmatter editor — raw YAML toggle. A toggle switches the frontmatter pane between the structured form and a raw YAML textarea. Changes made in raw mode are parsed back into the structured view on return.                                                                                   |
| PLW-16 | Markdown body editor with live preview. Split-pane by default on desktop (editor left, rendered HTML right); toggled between edit and preview on narrow viewports. Preview output must be sanitized before rendering, and raw HTML/MDX execution is disabled in v0.1.                                  |
| PLW-17 | Auto-save to local draft after 30 seconds of typing inactivity. The auto-save interval is a per-user setting. Auto-save is silently reflected in the file status badge.                                                                                                                          |
| PLW-18 | Manual save ("Save"): explicitly persist the current editor state to the `plainwrite_drafts` table with status `draft`.                                                                                                                                                                          |
| PLW-19 | Commit ("Commit"): mark the current draft as `committed` and prompt for an optional commit message (default: `Update <filename>`). The committed draft is ready to publish.                                                                                                                      |
| PLW-20 | Discard changes: revert the file to its last-fetched remote state. Clears the draft record. Requires explicit confirmation.                                                                                                                                                                      |

#### Publishing

| ID     | Requirement                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-21 | Publish single file: push the committed draft to the remote using the current user's credential. The provider adapter handles the API call. Conflict check (PLW-23) runs before the push; if a conflict is detected, shows a warning and blocks. If branch protection, missing scopes, or non-fast-forward ref updates block the push, Plainwrite records a failed publish event and shows a clear error. |
| PLW-22 | Publish All: from the file listing, create a single remote commit containing every file the current user has in `committed` state (edits and staged deletions). The provider adapter performs this atomically where the provider supports it. Conflict check runs across all files first. A summary of conflicts is shown; the user may skip conflicted files or abort the entire push. Direct pushes to protected branches fail clearly in v0.1; pull-request publishing is a later enhancement. |
| PLW-23 | Conflict detection: before any publish action, compare the draft's `base_sha` against the file's current remote blob identifier (fetched via the provider API). A mismatch means the remote file changed since the user started editing. New files (no `base_sha`) and staged deletions for non-existent files are not subject to conflict detection.                                   |

#### Schema

| ID     | Requirement                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-24 | Auto-detect collection frontmatter schema on first sync. For each collection, up to five existing files are fetched and their frontmatter is parsed. Field names and value types (string, date, number, boolean, array) are inferred and stored in `plainwrite_collection_schemas`.                |
| PLW-25 | Project owner can view and manually edit the inferred collection schema in project settings: add, remove, or rename fields; change the inferred type; mark fields as required. Manual edits override the auto-inferred schema and are not overwritten by subsequent syncs unless reset explicitly. |

---

### v0.2 — Rich text editor, Jekyll support, images

| ID     | Requirement                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-26 | Rich text editor (WYSIWYG): an alternative to the raw Markdown editor. Powered by a ProseMirror-based library (Tiptap or equivalent). Outputs clean CommonMark Markdown — no raw HTML is stored in content files.                                                                                 |
| PLW-27 | Jekyll support: a `JekyllAdapter` implementing the SSG adapter interface scans `_posts/`, `_pages/`, and `_drafts/` for Markdown content. Auto-detect Jekyll frontmatter schema. SSG type option `jekyll` becomes available in project creation. No changes to core file listing or editor logic. |
| PLW-28 | Image upload: upload an image file to the repository via the provider adapter. Upload path is configurable per project (default: `public/images/`). On upload, a Markdown image reference is inserted at the editor cursor position.                                                              |

---

### v0.3 — Collaboration and conflict resolution

| ID     | Requirement                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLW-29 | Advisory file lock: when a user opens a file for editing, record an advisory lock visible to other project members in the file listing (shows who is editing). Locks expire automatically after a configurable idle timeout. No hard enforcement — two users can still edit the same file, but the lock is a visible signal. |
| PLW-30 | Conflict resolution UI: when a conflict is detected (PLW-23), show a side-by-side diff of the remote version versus the local committed draft. User can choose: keep local (force-overwrite remote), keep remote (discard local draft), or cancel and merge manually.                                                        |
| PLW-31 | Custom SSG type: a "Custom" project type with a user-defined path prefix and file extension filter. Enables Hugo, Hexo, Eleventy, and similar generators whose content paths differ from Astro's `src/content/` convention.                                                                                                  |

---

## Architecture: provider adapters + DB drafts

Plainwrite keeps no server-side git clone. All content is retrieved and pushed
via provider REST APIs. Local edits live in the Sovereign database as draft
records until explicitly published.

Three layers of abstraction keep core logic free of provider and SSG specifics:

```
┌─────────────────────────────────────┐
│  Core (draft lifecycle, editor, UI) │
└────────────┬──────────┬─────────────┘
             │          │
   ┌──────────▼──┐  ┌────▼────────────┐
   │ Git provider│  │   SSG adapter   │
   │   adapter  │  │  (content disc.) │
   └──────────┬──┘  └────┬────────────┘
              │           │
   GitHub  GitLab  Astro  Jekyll  Hugo …
   Gitea   (self-hosted)
```

### Draft lifecycle

```
User edits file
      │
      ▼
  status: draft        ← Save / Auto-save (DB only, no provider)
      │
      ▼
  status: committed    ← Commit (adds commit message, no provider)
      │
      ▼
  status: published    ← Publish / Publish All (provider API call)
```

### Git provider adapter

Each provider implements a common interface:

```typescript
interface GitProviderAdapter {
  // File tree + content
  getFileTree(project: Project, creds: Credential): Promise<TreeEntry[]>;
  getFileContent(
    project: Project,
    path: string,
    creds: Credential,
  ): Promise<{ content: string; sha: string }>;

  // Publishing
  publishFile(project: Project, file: PendingFile, creds: Credential): Promise<void>;
  publishFiles(
    project: Project,
    files: PendingFile[],
    message: string,
    creds: Credential,
  ): Promise<void>;
  deleteFile(
    project: Project,
    path: string,
    sha: string,
    message: string,
    creds: Credential,
  ): Promise<void>;

  // Auth
  getOAuthUrl(state: string): string | null; // null if OAuth not configured for this provider
  exchangeOAuthCode(code: string): Promise<OAuthTokens>;
  resolveUserInfo(creds: Credential): Promise<{ login: string; displayName: string }>;
}
```

**Providers in v0.1:**

- **`GitHubProvider`** — github.com (and GitHub Enterprise Server via `provider_url`). Single-file publish uses the Contents API; multi-file publish uses the Git Data API (blob → tree → commit → ref update) for atomicity.

**Providers planned post-v0.1:**

- **`GitLabProvider`** — gitlab.com + self-hosted. Multi-file publish uses GitLab's Commits API (`actions` array — a single API call, cleaner than GitHub's multi-step approach).
- **`GiteaProvider`** — Gitea / Forgejo self-hosted instances (Codeberg, etc.). GitHub-compatible API; OAuth 2.0 + PAT.

The factory `getProvider(project)` returns the correct adapter instance from the `provider` and `provider_url` fields on the project. Core publish logic calls only the adapter interface — no provider `if/else` in core code.

### SSG adapter

Each SSG adapter implements content discovery:

```typescript
interface SsgAdapter {
  defaultPathPrefix: string;
  defaultExtensions: string[];
  discoverContent(tree: TreeEntry[], pathPrefix: string): ContentFile[];
  inferCollection(filePath: string, pathPrefix: string): string | null;
  defaultFrontmatterTemplate(collection: string | null): Record<string, unknown>;
}
```

**Adapters in v0.1:**

- **`AstroAdapter`** — path prefix `src/content`, extensions `.md`/`.mdx`. Collection = immediate subdirectory after the prefix.

**Adapters planned:**

- **`JekyllAdapter`** (v0.2) — scans `_posts/`, `_pages/`, `_drafts/`. Collection = directory name.
- **`CustomAdapter`** — user-defined prefix and extensions; flat listing, no automatic collection grouping.
- Future: Hugo (`content/`), Eleventy (user-configurable), Hexo (`source/_posts/`).

`getAdapter(project)` returns the correct adapter from `ssg_type`. The file listing (PLW-09), new-file action (PLW-11), and schema inference (PLW-24) call only the adapter interface.

### OAuth flow

For hosted providers with OAuth configured on the Sovereign instance:

```
1. User clicks "Connect [Provider]" in project credential settings
2. Server calls sdk.connections.createOAuthState() and redirects to the provider's
   authorization URL using the effective provider config
3. User approves on the provider's site
4. Provider redirects to /plainwrite/oauth/github/callback?code=...&state=...
5. Server calls sdk.connections.verifyOAuthState(), exchanges code for access +
   refresh tokens, stores token material in sdk.secrets, and creates/updates
   sdk.connections metadata with the provider login and secret_ref
```

OAuth requires the instance administrator to configure Client ID and Client
Secret for each provider through the manifest-declared `connections.providers`
config. Console-managed provider config takes precedence. Plugin-scoped runtime
env vars are allowed as a fallback:

- `SV_PLUGIN_FS_SOVEREIGN_PLAINWRITE_GITHUB_CLIENT_ID`
- `SV_PLUGIN_FS_SOVEREIGN_PLAINWRITE_GITHUB_CLIENT_SECRET`

**PAT fallback:** When OAuth is not configured for a provider — including all
self-hosted instances where registering an OAuth App per server is impractical —
the user enters a Personal Access Token manually. The PAT is immediately stored
with `sdk.secrets.create({ scope: 'user', ... })`; Plainwrite stores only
metadata and the returned secret reference. Required minimum scopes are:

- GitHub public repositories: `contents:read` for browsing and `contents:write`
  for publishing.
- GitHub private repositories: fine-grained repository access with contents
  read/write, or equivalent classic token scope where fine-grained tokens are not
  available.

Token refresh failures call `sdk.connections.markError()` with sanitized details
and place the project credential in `needs_reauth` state.

### Credential encryption

Plainwrite does not store plaintext tokens or plugin-local encrypted tokens in
its own tables for the current implementation. Runtime credentials are stored in
the platform plugin secret vault via `sdk.secrets`; Plainwrite stores only
`secret_ref`, provider login, expiry metadata, and connection status.

If an older prototype exists with AES-256-GCM columns, treat that data as a
one-time migration source: decrypt once, create a vault secret, write
`secret_ref`, and clear the legacy encrypted columns. New code must not require a
global `SOVEREIGN_ENCRYPTION_KEY`.

### Multi-file publish — GitHub details

For reference, the GitHub provider's `publishFiles` implementation:

```
1. GET  /repos/{owner}/{repo}/git/ref/heads/{branch}   → latest commit SHA
2. GET  /repos/{owner}/{repo}/git/commits/{sha}         → tree SHA
3. POST /repos/{owner}/{repo}/git/blobs (×N)            → one blob per changed file
4. POST /repos/{owner}/{repo}/git/trees                 → new tree
5. POST /repos/{owner}/{repo}/git/commits               → new commit
6. PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}  → advance branch pointer
```

The branch ref is updated only after all blobs and the tree are created. If step
6 fails, dangling objects are abandoned (GitHub garbage-collects them); no
partial commit lands on the branch.

Protected branches, required status checks, missing token scopes, and
non-fast-forward ref updates are expected provider failures in v0.1. Plainwrite
does not bypass them. It records a failed publish event, preserves the committed
draft, and shows an actionable error. Pull-request based publishing is reserved
for a later milestone.

GitLab's equivalent is a single call: `POST /projects/:id/repository/commits`
with an `actions` array. The adapter interface hides this difference from the
rest of the codebase.

---

## Directory structure

```
sovereign-plainwrite/
├── manifest.json
├── icon.svg                          # Plainwrite icon — sidebar middle section + Launcher grid
├── app/
│   ├── layout.tsx                    # Plainwrite shell — project sidebar + content area
│   ├── page.tsx                      # All projects overview
│   ├── oauth/
│   │   └── github/
│   │       └── callback/
│   │           └── route.ts          # OAuth callback — verifies sdk.connections state
│   └── [projectId]/
│       ├── page.tsx                  # File listing + collection navigation
│       ├── settings/
│       │   └── page.tsx              # Project settings, member management, schema editor
│       └── editor/
│           └── [...filePath]/
│               └── page.tsx          # Editor view (frontmatter + body)
├── db/
│   └── schema.ts                     # all plainwrite_* tables
├── migrations/
├── components/
│   ├── FileTree.tsx                  # Collection/file listing with status badges
│   ├── FrontmatterForm.tsx           # Structured frontmatter inputs
│   ├── FrontmatterYaml.tsx           # Raw YAML textarea (toggle view)
│   ├── MarkdownEditor.tsx            # Split-pane markdown editor + preview
│   ├── CommitPanel.tsx               # Commit message input + Commit/Publish buttons
│   ├── ConflictWarning.tsx           # Conflict detected banner + options
│   └── SchemaSetting.tsx             # Collection schema editor in settings
├── lib/
│   ├── providers/
│   │   ├── types.ts                  # GitProviderAdapter interface + shared types
│   │   ├── github.ts                 # GitHub provider (github.com + GHE)
│   │   ├── gitlab.ts                 # GitLab provider (v0.2+; placeholder in v0.1)
│   │   └── index.ts                  # getProvider(project) factory
│   ├── ssg/
│   │   ├── types.ts                  # SsgAdapter interface + shared types
│   │   ├── astro.ts                  # Astro adapter
│   │   ├── jekyll.ts                 # Jekyll adapter (v0.2+; placeholder in v0.1)
│   │   └── index.ts                  # getAdapter(project) factory
│   ├── frontmatter.ts                # Parse/serialize frontmatter via gray-matter
│   ├── schema-infer.ts               # Auto-detect collection schema from file samples
│   ├── oauth.ts                      # OAuth provider URL + token exchange helpers
│   └── secrets.ts                    # sdk.secrets helpers; no plugin-local token storage
└── package.json
```

**Key dependency:** `gray-matter` — de-facto standard for parsing YAML/TOML
frontmatter from Markdown files. No viable alternative with the same feature set
and maintenance status.

Markdown preview must use a CommonMark-compatible parser plus an HTML sanitizer.
MDX execution and raw HTML rendering are out of scope for v0.1.

---

## Data model

Seven tables, all prefixed `plainwrite_`. All carry `tenant_id` per the platform
architectural rule (SRS hard rules).

### `plainwrite_projects`

| Column         | Type       | Notes                                                                                                                                    |
| -------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | uuid / pk  |                                                                                                                                          |
| `tenant_id`    | string     |                                                                                                                                          |
| `created_by`   | string     | FK → users.                                                                                                                              |
| `name`         | string     |                                                                                                                                          |
| `description`  | string?    | Nullable.                                                                                                                                |
| `provider`     | string     | Enum: `github` \| `gitlab` \| `gitea` \| `custom`. v0.1: `github` only. Selects the `GitProviderAdapter` implementation.                 |
| `provider_url` | string?    | Nullable. Base URL for self-hosted instances (e.g. `https://gitlab.mycompany.com`). Null for well-known hosted providers.                |
| `repo_owner`   | string     | Repository namespace (GitHub username/org, GitLab group/user). Parsed from the repo URL on project creation.                             |
| `repo_name`    | string     | Repository name. Parsed from the repo URL.                                                                                               |
| `branch`       | string     | Default: `main`.                                                                                                                         |
| `path_prefix`  | string     | Default: `src/content`. Root path scanned for content files. Meaning is provider-independent; interpretation belongs to the SSG adapter. |
| `ssg_type`     | string     | Enum: `astro` \| `jekyll` \| `custom`. v0.1: `astro` only. Selects the `SsgAdapter` implementation.                                      |
| `is_private`   | boolean    | Informational flag set on project creation. Does not gate access.                                                                        |
| `metadata_visibility` | string | Enum: `members_with_credentials` \| `all_members`. Default: `members_with_credentials` for private repos and `all_members` for public repos. Controls cached file listing visibility for members without credentials. |
| `archived_at`  | timestamp? | Nullable. Soft-archive timestamp.                                                                                                        |
| `created_at`   | timestamp  |                                                                                                                                          |
| `updated_at`   | timestamp  |                                                                                                                                          |

### `plainwrite_project_members`

| Column       | Type                          | Notes                                                        |
| ------------ | ----------------------------- | ------------------------------------------------------------ |
| `project_id` | uuid                          | FK → `plainwrite_projects`.                                  |
| `tenant_id`  | string                        |                                                              |
| `user_id`    | string                        | FK → users.                                                  |
| `role`       | `owner` \| `editor` \| `viewer` | Owner row is inserted automatically on project creation.   |
| `invited_by` | string?                       | Nullable. FK → users. Null for the original project creator. |
| `joined_at`  | timestamp                     |                                                              |

Composite PK: (`project_id`, `user_id`).

### `plainwrite_credentials`

| Column             | Type       | Notes                                                                                                                                                   |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project_id`       | uuid       | FK → `plainwrite_projects`.                                                                                                                             |
| `tenant_id`        | string     |                                                                                                                                                         |
| `user_id`          | string     | FK → users.                                                                                                                                             |
| `provider`         | string     | Matches the project provider, e.g. `github`.                                                                                                            |
| `auth_type`        | string     | Enum: `oauth` \| `pat`. Determines how the credential was obtained.                                                                                     |
| `connection_id`    | string?    | Reference to `sdk.connections` metadata for OAuth-backed credentials. Null for PAT-only providers if no connection row is created.                      |
| `secret_ref`       | string     | Required reference to `sdk.secrets`; token material is not stored in Plainwrite tables.                                                                  |
| `token_expires_at` | timestamp? | Nullable. Expiry for short-lived access tokens. Null for PATs and non-expiring OAuth tokens. When set, the provider adapter refreshes before API calls. |
| `provider_login`   | string?    | Nullable. Username on the provider (e.g. `kasunben` on GitHub). Resolved on connect; stored for display and commit attribution.                         |
| `status`           | string     | Enum: `connected` \| `needs_reauth` \| `revoked` \| `error`.                                                                                            |
| `last_error`       | string?    | Nullable sanitized error code/message for operator/user troubleshooting. No tokens, URLs with credentials, or provider response bodies.                 |
| `created_at`       | timestamp  |                                                                                                                                                         |
| `updated_at`       | timestamp  |                                                                                                                                                         |

Composite PK: (`project_id`, `user_id`).

### `plainwrite_file_cache`

| Column           | Type      | Notes                                                                                                                         |
| ---------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid / pk |                                                                                                                               |
| `tenant_id`      | string    |                                                                                                                               |
| `project_id`     | uuid      | FK → `plainwrite_projects`.                                                                                                   |
| `path`           | string    | Full path in repo (e.g. `src/content/blog/my-post.md`).                                                                       |
| `collection`     | string?   | Nullable. Derived: immediate subdirectory after `path_prefix`. Null for files directly in the prefix ("Root" in the listing). |
| `filename`       | string    | Filename only (e.g. `my-post.md`).                                                                                            |
| `sha`            | string    | Provider blob identifier at last sync (SHA hash for GitHub/GitLab/Gitea). Used as the baseline for conflict detection.        |
| `last_synced_at` | timestamp |                                                                                                                               |

Unique index: (`project_id`, `path`).

### `plainwrite_drafts`

| Column           | Type       | Notes                                                                                                                                                                     |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid / pk  |                                                                                                                                                                           |
| `tenant_id`      | string     |                                                                                                                                                                           |
| `project_id`     | uuid       | FK → `plainwrite_projects`.                                                                                                                                               |
| `file_path`      | string     | Full repo path. For new files, no corresponding row in `plainwrite_file_cache` yet.                                                                                       |
| `user_id`        | string     | FK → users. Each user has at most one active draft per file.                                                                                                              |
| `content`        | text?      | Nullable. Full file content (frontmatter + body). `null` represents a staged deletion.                                                                                    |
| `status`         | string     | Enum: `draft` \| `committed` \| `published`.                                                                                                                              |
| `commit_message` | string?    | Nullable. Set on Commit action.                                                                                                                                           |
| `base_sha`       | string?    | Nullable. Provider blob identifier when the file was fetched. `null` for new files. Compared against the current remote identifier before publish for conflict detection. |
| `committed_at`   | timestamp? | Nullable.                                                                                                                                                                 |
| `published_at`   | timestamp? | Nullable.                                                                                                                                                                 |
| `created_at`     | timestamp  |                                                                                                                                                                           |
| `updated_at`     | timestamp  |                                                                                                                                                                           |

Unique index: (`project_id`, `file_path`, `user_id`). Upsert on this key — at
most one active draft per file per user.

**Draft re-open logic:** When a user opens a file, if a `draft` or `committed`
draft exists for that user, it is loaded. If the most recent draft is
`published`, it is ignored and fresh content is fetched from the provider. This ensures
the editor always reflects either the user's unpublished work or the current
remote state.

### `plainwrite_collection_schemas`

| Column        | Type       | Notes                                                                                                                                                        |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`          | uuid / pk  |                                                                                                                                                              |
| `tenant_id`   | string     |                                                                                                                                                              |
| `project_id`  | uuid       | FK → `plainwrite_projects`.                                                                                                                                  |
| `collection`  | string     | Collection name. `__root__` for files directly in the path prefix with no subdirectory.                                                                      |
| `schema`      | json       | Array of `{ name: string, type: "string" \| "date" \| "number" \| "boolean" \| "array", required: boolean, default?: string \| number \| boolean \| null }`. |
| `inferred_at` | timestamp? | Nullable. Timestamp of last auto-detection run. Null if schema was created entirely manually.                                                                |
| `updated_at`  | timestamp  |                                                                                                                                                              |
| `updated_by`  | string?    | Nullable. FK → users. Set when a project owner manually edits the schema; null for auto-inferred schemas not yet manually touched.                           |

Unique index: (`project_id`, `collection`).

**Schema inference:** On first sync, Plainwrite fetches up to five files from
each collection via the provider adapter and calls `gray-matter` to parse their
frontmatter. For each field, the type is inferred from the union of values
observed (string wins over number when types are mixed). The resulting schema is
a best-effort starting point; the project owner is expected to review and correct
it via PLW-25.

### `plainwrite_publish_events`

| Column          | Type       | Notes                                                                                                                      |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`            | uuid / pk  |                                                                                                                            |
| `tenant_id`     | string     |                                                                                                                            |
| `project_id`    | uuid       | FK → `plainwrite_projects`.                                                                                                |
| `user_id`       | string     | FK → users. User who attempted the publish.                                                                                |
| `provider`      | string     | Provider used for the publish attempt.                                                                                     |
| `branch`        | string     | Target branch.                                                                                                             |
| `commit_sha`    | string?    | Nullable. Provider commit SHA when the publish succeeds.                                                                    |
| `message`       | string     | Commit message submitted to the provider.                                                                                  |
| `files`         | json       | Array of `{ path: string, action: "create" \| "update" \| "delete", base_sha?: string }`.                                  |
| `status`        | string     | Enum: `success` \| `failed`.                                                                                               |
| `error_code`    | string?    | Nullable provider-normalized code such as `protected_branch`, `missing_scope`, `conflict`, or `rate_limited`.              |
| `error_summary` | string?    | Nullable sanitized message suitable for display and export.                                                                |
| `created_at`    | timestamp  |                                                                                                                            |

Publish events are append-only. Export includes successful and failed publish
metadata, but never includes credentials or raw provider error bodies.

---

## SDK dependencies

| SDK surface | Used for                                                | Available from |
| ----------- | ------------------------------------------------------- | -------------- |
| `sdk.auth`          | Current user session                            | Stable       |
| `sdk.directory`     | User lookup for project member management       | RFC 0041     |
| `sdk.db`            | Read/write all `plainwrite_*` tables            | Stable       |
| `sdk.notifications` | Share/publish notifications                     | Experimental |
| `sdk.activity`      | Platform-visible project/publish events         | Experimental |
| `sdk.data`          | Expose project metadata and content snippets    | Experimental |
| `sdk.secrets`       | Git provider OAuth/PAT credentials              | RFC 0043     |
| `sdk.connections`   | OAuth state, provider config, connection status | RFC 0049     |
| `sdk.portability`   | Export/import/delete participation              | Experimental |
| `sdk.tools`         | Future confirmed create/publish actions         | RFC 0047     |

Plainwrite requires no `sdk.mailer` in v1.

### Data contracts

Candidate read-only contracts:

| Contract                   | Version | Shape                                      |
| -------------------------- | ------- | ------------------------------------------ |
| `plainwrite.projects`      | 1       | Projects visible to the current user. |
| `plainwrite.content-index` | 1       | File metadata and searchable snippets for projects where the current user has access and the project metadata visibility setting permits exposure. |
| `plainwrite.drafts`        | 1       | Draft metadata for the current user. Full draft content is never exposed by default and requires an explicit future contract revision. |

### Portability and deletion

Export includes project metadata, memberships, file cache metadata, draft
content, schema settings, and publish history. Git credentials are not exported.
Import restores projects and drafts additively; users must reconnect provider
credentials. User deletion deletes that user's credentials and drafts, removes
or transfers owned projects according to membership, preserves append-only
publish metadata where required for project history, and preserves remote git
history because it lives outside Sovereign.

---

## UI

Plainwrite consumes `@sovereignfs/ui` (components and `--sv-*` tokens)
exclusively.

**Layout:** Two-panel on desktop — project/collection sidebar on the left,
content area on the right. The editor is full-width when open (sidebar collapses
to an icon strip). Collapses to a single-pane stack on mobile.

**Existing `@sovereignfs/ui` primitives to reuse first:**

- `StatusBadge` for Unmodified / Draft / Committed / Conflict / Pending delete
  file states.
- `SplitPane` for editor + preview and list + detail layouts.
- `TagInput` for frontmatter array fields.
- `CodeTextarea` for Markdown, raw YAML, and other whitespace-sensitive editing.
- `Textarea`, `Input`, `Select`, `Toggle`, `Tabs`, `FormField`, `Button`, and
  `Badge` for standard forms, filters, and metadata surfaces.

Only add new `packages/ui` primitives if Plainwrite needs a reusable control not
covered by the current design system. Plugin-local one-off widgets should remain
inside Plainwrite.

---

## Build plan

Four release milestones, implemented as smaller agent-ready PRs in the
`sovereign-plainwrite` repo. Requires a Sovereign platform version that
includes `sdk.directory`, `sdk.secrets`, `sdk.connections`, and `sdk.data`.

### v0.1 — Core (PLW-01–25), split into implementation tasks

1. **Scaffold and manifest:** create the external plugin repository with the
   manifest above, route shell, icon, SDK/UI dependencies, database schema, and
   migrations for `plainwrite_*` tables.
2. **Project CRUD and membership:** implement project create/edit/archive,
   `owner`/`editor`/`viewer` membership, and private metadata visibility.
3. **GitHub PAT connection:** implement PAT-backed GitHub credentials first using
   `sdk.secrets`; store only `secret_ref` and sanitized metadata in
   `plainwrite_credentials`.
4. **Read-only file sync:** implement `GitProviderAdapter`, `AstroAdapter`, file
   tree sync, file cache refresh, status badges, and owner-controlled cached
   metadata visibility.
5. **Editor and drafts:** implement file open, sanitized Markdown preview,
   frontmatter parsing, auto-save, manual save, commit state, and discard.
6. **Single-file publish:** implement conflict check, direct GitHub publish,
   publish event logging, protected-branch/missing-scope errors, and draft state
   updates.
7. **Publish all and schema tools:** implement multi-file publish, staged
   deletion, schema inference, and manual schema editing.
8. **GitHub OAuth:** add `sdk.connections` OAuth flow after PAT publishing works,
   including state verification, vault-backed token storage, refresh handling,
   and `needs_reauth` status.

**Done when:** A user can connect a GitHub repo, browse its Astro content
collections, open a Markdown file, edit frontmatter and body, commit locally, and
publish to GitHub with conflict checks, publish audit records, and clear provider
failure handling.

### v0.2 — Rich text, Jekyll, images (PLW-26–28)

WYSIWYG rich text editor mode (Tiptap / ProseMirror), Jekyll adapter
(`JekyllAdapter` implementing `SsgAdapter`), image upload via provider adapter
with cursor insertion.

**Done when:** A non-technical user can write content without seeing Markdown
syntax; a Jekyll site can be connected; images can be uploaded from the editor.
Adding Jekyll required only a new `SsgAdapter` implementation — no changes to
core editor or publish logic.

### v0.3 — Collaboration (PLW-29–31)

Advisory file locking with presence indicator, conflict resolution diff UI
(keep local / keep remote / cancel), custom SSG type with configurable path
prefix.

**Done when:** Multiple users working on the same project see who is editing
which file; a user encountering a conflict can resolve it from within the UI
without reaching for a git client; Hugo/Hexo/Eleventy repositories are
connectable.

### v1.0 — Stable

Polish, documentation, plugin developer guide entry. Plainwrite is the reference
implementation for plugins that interact with third-party APIs and manage
credentials.

---

## Open questions

1. **Protected branch workflow.** v0.1 fails clearly when direct publish is
   blocked by branch protection. A future milestone should decide whether to
   create pull requests, provider-specific merge requests, or a review branch.

2. **Self-hosted providers and OAuth.** Registering an OAuth App for every
   possible self-hosted Gitea/GitLab instance is impractical. For self-hosted
   providers (`provider_url` is non-null), PAT is the primary auth method — no
   OAuth flow is offered. Confirm this is acceptable, or decide whether Plainwrite
   should support a "bring your own OAuth app" mode where the project owner
   supplies a client ID/secret for their specific instance.

3. **New collection creation.** v0.1 allows creating files only within collections
   that already exist in the repository. Creating a new Astro collection (a new
   subdirectory under `src/content/`) requires a placeholder file. Flag for v0.2:
   a "New collection" action that creates a `.gitkeep`-style placeholder via the
   provider adapter, then refreshes the file cache.

4. **Publish All commit message.** When publishing multiple committed files
   (PLW-22), each file may have its own commit message. For the single combined
   commit: (a) generic message (`Publish N files`), (b) joined individual
   messages, or (c) prompt for a combined message with individual messages shown
   for reference. Recommendation: option (c).

5. **Staged deletion and conflicts.** If a user has staged a deletion and the
   remote file was modified, the conflict is ambiguous: remote updated, local
   deleted. PLW-23 will detect and block. PLW-30 (v0.3) should handle this as a
   distinct "delete vs. update" conflict type, not the same as an edit conflict.

6. **Provider API rate limits.** Schema inference (PLW-24) fetches up to 5 files
   per collection. GitHub: 5,000 req/hr per token; GitLab: 2,000 req/10 min;
   Gitea: instance-configurable. Schema inference runs only once (at first sync).
   If rate limits become a concern, batch via the provider's recursive tree API to
   fetch the full tree in one call, with content fetched lazily on first open.

---

## Changelog

| Version | Date     | Change                                                                                                                                                                                                                                                                                                   |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.3     | Jun 2026 | Aligned manifest and credential design with `sdk.connections`, `sdk.secrets`, plugin-scoped provider config, and declared data contracts. Added viewer role, private metadata visibility, publish failure semantics, publish event history, sanitized preview requirement, and an implementation-sliced v0.1 plan. |
| 0.2     | Jun 2026 | Replaced manual PAT with OAuth 2.0 flow (PAT as fallback). Introduced `GitProviderAdapter` and `SsgAdapter` interfaces. Added `provider`/`provider_url` columns to projects; revised credentials table for OAuth tokens and refresh tokens. Added manifest `icon` field and missing `tenant_id` columns. |
| 0.1     | Jun 2026 | Initial draft — feature set, data model, and GitHub API architecture designed from scratch.                                                                                                                                                                                                              |
