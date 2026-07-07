# Plainwrite

Plainwrite is a Sovereign plugin for editing Markdown content in git-backed
static sites. The current implementation covers the v0.1 foundation: project
management, project membership, GitHub content sync, local draft editing,
single-file and publish-all GitHub publishing, staged deletion, schema tools,
GitHub OAuth, and GitHub personal access token storage through the Sovereign
secret vault.

## Local development

To test this standalone checkout against the platform, clone or copy it into a
platform workspace as a local plugin checkout:

```bash
plugins/sovereign-plainwrite.local
```

Then run the platform generate/dev workflow from the platform repository:

```bash
pnpm generate
pnpm dev
```

The app is served at `/plainwrite` once composed by the platform.

## Current scope

Implemented now:

- Sovereign manifest with data contracts, external GitHub provider declaration,
  portability permissions, and `0.18.2` platform compatibility.
- Project CRUD, settings, archive/delete, and member roles.
- GitHub sync for Astro Markdown/MDX content under the configured path prefix,
  using anonymous reads for public repositories and the current user's connected
  OAuth or PAT credential for private repositories.
- Local editor workflow for opening remote content, creating new files, editing
  raw YAML frontmatter and Markdown body, previewing escaped Markdown, saving
  drafts, marking drafts ready to commit, publishing one committed file, and
  discarding drafts.
- GitHub OAuth connection UI backed by manifest-declared `sdk.connections`
  provider config, with PAT fallback when OAuth is not configured. Tokens are
  stored with `sdk.secrets`; Plainwrite stores only `connection_id`,
  `secret_ref`, provider, auth type, account login, status, and sanitized
  metadata.
- Single-file publish uses the current user's GitHub token, checks the remote
  blob SHA before writing, preserves committed drafts on conflict or provider
  failure, updates the local file cache after success, and records
  `plainwrite_publish_events` rows for both success and failure.
- Publish-all creates one GitHub commit for committed edits and staged
  deletions after conflict checks. Users can abort on conflicts or explicitly
  skip conflicted files.
- Collection schema inference samples synced files and gives owners editable
  schema controls with reset-to-inferred behavior.

Not implemented yet:

- Pull-request publishing and structured conflict-resolution UI.
- Structured frontmatter fields, autosave, data contracts, portability
  handlers, notifications, and activity events.

## GitHub credentials

Each user connects their own GitHub credential per project from **Project
settings → GitHub credential**. If the Sovereign instance has GitHub OAuth
provider config, Plainwrite starts the hosted OAuth flow through
`sdk.connections`. Otherwise, users can enter a fine-grained GitHub token scoped
to the selected repository:

- Contents read access is required for private repository sync.
- Contents write access is required for publishing committed drafts.

Plainwrite validates the credential against GitHub before storing it. The token
value is never persisted in Plainwrite tables, exported, or rendered back to the
client. Disconnecting a credential disconnects the platform connection or deletes
the platform vault secret, then marks the Plainwrite credential metadata as
disconnected without deleting project drafts.
