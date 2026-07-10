# Plainwrite UI redesign — writer-first simplification

**Status:** Phases 1–3 complete — see PLW-019/PLW-020/PLW-021 in `roadmap.md`.
Phases 4–6 (conflict review, connect wizard, editor modes) remain proposals.
**Date:** 2026-07-10
**Wireframe assets:** [`docs/adhoc/plainwrite-ui-redesign/`](./plainwrite-ui-redesign/) (SVG, one per screen)

## 1. The problem

The current UI is feature-complete but speaks **git, not writing**. A non-technical
user sees: "Base revision `5fd9aa79…`", "Commit message", "Mark ready", "Sync
content", "Path prefix", "Pending delete". Every one of those is a git concept
leaking through the surface. The dashboard is also project-ops-centric (repo
settings, sync state, publish events) when the user's actual job is "write and
publish posts" — the writing surface is one click deeper than the infrastructure.

## 2. Direction

Two decisions, made together:

1. **Progressive disclosure now** — keep one UI, but give it a plain-language
   surface with git details available on demand (an "Advanced" disclosure, not a
   separate mode). This is mostly a copy + reorganization pass over the existing
   pages.
2. **Pipeline framing as the north star** — the existing draft state machine
   (`draft` → `committed` → `published`) _is_ a writer's pipeline
   (**Writing → Ready to publish → Live on site**). The UI should show it as one,
   instead of hiding it in status badges.

Nothing in the data model or the actions layer changes for the core redesign —
it is a re-projection of state that already exists. The exceptions (new
dependencies, small schema additions) are listed in §6.

## 3. Language

"Plugin" vs "app" already has a naming convention in this repo; this extends the
same principle to Plainwrite's own domain terms. Users never see git vocabulary:

| Internal (code, schema, git)           | User-facing                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| project                                | **site**                                                   |
| content file / `post-1.md`             | **post** (title from frontmatter)                          |
| collection                             | **section**                                                |
| draft status `draft`                   | **Writing** / "Draft — only you see this"                  |
| draft status `committed`               | **Ready to publish**                                       |
| draft status `published` / no draft    | **Live on site**                                           |
| pending-delete                         | "Removes from site on next publish · undo"                 |
| sync content                           | "Check for site updates" (automatic; quiet status chip)    |
| commit message                         | auto-generated "Update ⟨title⟩"; visible under Advanced    |
| base revision / SHA                    | never shown (Advanced only)                                |
| repo URL / branch / path prefix        | "Where your site lives" (setup only)                       |
| PAT / OAuth credential                 | "Publishing access"                                        |
| credential `needs_reauth`              | "Publishing access expired — reconnect"                    |
| publish conflict                       | "This post changed on your site while you were editing"    |
| roles viewer / editor / owner          | display as **Reader / Writer / Owner** (same stored roles) |

## 4. Screens

The complete journey: home (2 states) → connect wizard → site content home →
new post → editor (3 modes) → publish → conflict review → setup.

### 4.1 Home — empty state

![Home, no sites yet](./plainwrite-ui-redesign/01-home-empty.svg)

- One action ("Connect a site"), a three-step preview of setup (so it feels
  bounded before it starts), and a footer for the second persona — invited
  writers who will never create a site themselves.

### 4.2 Home — with sites

![Home with three site cards](./plainwrite-ui-redesign/02-home-sites.svg)

- Cards answer three questions at a glance: healthy? (status dot), work in
  motion? ("2 writing · 1 ready"), my role? (Owner/Writer).
- `needs_reauth` surfaces at the front door in plain words — before someone has
  written 800 words, not at the publish click.
- Archived sites collapse to one quiet footer line.

### 4.3 Connect-a-site wizard

![Wizard step 1: where does your site live](./plainwrite-ui-redesign/03-connect-wizard.svg)

- **Detection replaces the form.** `parseGitHubRepositoryUrl` + `getFileTree` +
  the SSG adapter's `inferCollection` can find the content folder and count
  posts from one unauthenticated fetch on a public repo. Branch, path prefix,
  SSG type, and name become suggestions to confirm, not blanks to fill.
- Private repo: step 2 (connect access) happens before detection instead of
  after.
- Metadata visibility gets a safe default and moves to settings.
- Steps: 1 point to your site → 2 connect access → 3 confirm and import.

### 4.4 Site content home

![Post list with pipeline tabs](./plainwrite-ui-redesign/04-content-home.svg)

- Posts replace files: frontmatter title, section + edited time as subtitle.
- Pipeline tabs (All / Writing / Ready to publish / Live on site) are the
  existing status queries, surfaced as navigation.
- Sync collapses to a quiet "Site up to date · checked N min ago" chip;
  failures surface in plain words inline.
- "Put N posts live" replaces "Publish all" + the skip-conflicts checkbox.
- Repo card, setup checklist, and publish-events log leave the daily view.

### 4.5 New post

![New post dialog](./plainwrite-ui-redesign/05-new-post.svg)

- Title first; filename auto-generated from the slug and shown as a muted
  "will be saved as … · change" escape hatch. Section picker = collections.

### 4.6 Editor — Write mode (rich text, default)

![Editor in rich text mode](./plainwrite-ui-redesign/06-editor-write.svg)

- Mode switcher (Write / Markdown / Preview) affects the body only; Post
  details (structured frontmatter — already built) stays put.
- Toolbar + `/` block menu write markdown behind the scenes.
- Status pill explains itself ("Draft — only you see this"); one primary button
  changes with state: Ready to publish → Publish → Live.
- Raw frontmatter, file path, and change note (commit message) live under one
  "Advanced" disclosure. Base revision is never shown.

### 4.7 Editor — Markdown mode

![Editor in markdown mode](./plainwrite-ui-redesign/07-editor-markdown.svg)

- The same document as monospace source; syntax hint footer with a guide link.
- Mode is remembered per user. Default for new users: Write.

### 4.8 Editor — Preview mode

![Editor in preview mode](./plainwrite-ui-redesign/08-editor-preview.svg)

- Full-width reading view replaces the always-visible side preview panel.
- Honest caption: preview uses simple styles, not the site's actual design
  (matches what `renderSafeMarkdownPreview` really does).
- Desktop/mobile width toggle; read time + word count.

### 4.9 Publish confirmation

![Publish confirmation dialog](./plainwrite-ui-redesign/09-publish-confirm.svg)

- Replaces three git concepts at once: "Publish all" + "Skip conflicts" + the
  thrown conflict error become one confirmation that lists what goes live and
  **holds back** conflicted posts with an explanation and a review path.
- Commit messages auto-generated; no field shown.

### 4.10 Conflict review

![Conflict review, two versions side by side](./plainwrite-ui-redesign/10-conflict-review.svg)

- The "Review changes" destination. Three actions map to real operations:
  - **Use the site's version** = discard draft (exists today).
  - **Keep editing mine** = reopen editor with the draft's `baseSha` refreshed
    to the site's current revision.
  - **Publish mine anyway** = explicit overwrite; `assertNoPublishConflict`
    currently forbids this and would need a deliberate override path.
- Paragraph-level diff is the only new machinery; a crude "highlight changed
  blocks" version delivers most of the value.

### 4.11 Site setup (owner-only)

Wireframed in the session as a sidebar-sectioned settings area (Connection /
People / Content model / Danger zone), separated from daily use:

- "Where your site lives" (repo/branch/folder) and "Publishing access"
  (credential) as plain-language cards with Change/Manage actions.
- First run, the Connection cards become the 3-step wizard (§4.3).

## 5. Pages intentionally not redesigned

| Page                        | Status                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| People (invite/remove)      | Interaction already rebuilt (search-by-name/email picker); restyle into Site setup "People" with Reader/Writer/Owner |
| Content model (schemas)     | Owner-only and inherently technical; current editor is fine inside setup — lowest priority                          |
| Publish history             | Today's "Publish events" panel becomes a quiet "History" tab in setup                                                |
| Danger zone (archive/delete) | Standard confirm patterns already exist; relocated only                                                             |
| Delete post                 | Not a page — a row action plus the pending-delete pill with undo                                                     |
| Error page                  | Plugin `error.tsx` boundary already exists with plain copy                                                           |
| Mobile variants             | A dimension, not a page — the platform DS mobile work applies across all screens                                     |

## 6. Engineering notes and new dependencies

1. **Rich-text editor (Write mode)** — the single biggest new dependency in the
   whole redesign. Needs a markdown-serializing editor (ProseMirror/TipTap or
   Milkdown). Markdown remains the storage format in all modes; Write mode is a
   view over it, so files still diff sanely in GitHub.
2. **Site URL field** — cards show `acme.com`, but only `repoOwner/repoName` is
   stored today. Either fall back to the repo name or add an optional
   "site address" column (also unlocks "View site ↗" links). Small schema
   addition, recommended.
3. **Repo detection endpoint** — the wizard's "Found it" step is a thin wrapper
   over existing `getFileTree` + `inferCollection` logic, run at setup time.
4. **Conflict override path** — "Publish mine anyway" needs an explicit
   bypass of `assertNoPublishConflict` (publish with refreshed base sha).
5. **Image upload** — the Write-mode image block implies asset upload, which
   does not exist; today an image is a hand-typed repo-relative path. Uploading
   via the git provider (commit to an assets folder) is its own roadmap task;
   until then the image button inserts a path placeholder.
6. **Per-user drafts vs shared state** — the post list mixes "my draft" state
   with shared "live" state. Pills handle it for now ("only you see this");
   multi-writer presence ("Sarah is editing this") would be a data-model
   addition, explicitly out of scope here.

## 7. Open questions

- **Where do sections (collections) go at scale?** Demoted to a subtitle in the
  wireframes; a site with many collections would earn a left-nav or filter.
  Decide after seeing a real multi-collection project.
- **"Site" vs "project" rename scope** — user-facing strings only, or also
  routes (`/plainwrite/[projectId]`)? Recommendation: strings only; routes are
  internal.
- **Does the Writer view need the raw file tree at all**, or is the post list
  with the Advanced file-path escape hatch enough?

## 8. Suggested phasing

Each phase is shippable on its own and roughly maps to one roadmap task.

1. **Copy pass** ✅ — jargon translation table (§3) applied to existing
   screens; status pills, button labels, empty states, error strings. No
   layout change. (PLW-019)
2. **Navigation + home restructure** ✅ — site cards (both home states),
   content home with pipeline tabs, settings split into the owner-only setup
   area. (PLW-020)
3. **New post + publish flow** ✅ — title-first dialog, publish confirmation
   listing what goes live. No true conflict preflight yet (that's phase 4);
   skipped conflicts still resolve server-side and surface via the existing
   inline `ActionResult` message. (PLW-021)
4. **Conflict review** — the two-version screen and the baseSha-refresh /
   override actions.
5. **Connect-a-site wizard** — detection endpoint + 3-step flow, replacing the
   new-project form.
6. **Editor modes** — mode switcher, Preview mode (cheap), then Write mode
   (rich-text dependency — the largest single work item; can ship last).

Image upload and multi-writer presence are follow-on tasks outside this epic.
