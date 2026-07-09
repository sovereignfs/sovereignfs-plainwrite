# Plainwrite (sovereign-plainwrite) — code review & fix plan

> **Status:** review complete 2026-07-09; fixes not started. Written for handoff —
> any agent can pick this up. Re-verify line references before editing; files may
> have drifted.
> **Repo under review:** this repository (`sovereign-plainwrite`, on `main`) —
> mounted in the platform monorepo as `plugins/sovereign-plainwrite.local/`.
> All file paths below are relative to this repo's root. All fixes land here as
> this repo's own branches/PRs, following `roadmap.md` task IDs (PLW-*). Do not
> mix with platform-monorepo changes.
> **Roadmap position:** PLW-001–003 complete; PLW-004 done minus credential
> tests; PLW-005 complete (read-only sync); PLW-006 partial; PLW-007 complete
> (single-file publish). PLW-008+ (publish-all, OAuth, data contracts,
> hardening) pending. Findings below distinguish *bugs in shipped code* from
> *known future work* — don't re-report the latter as defects.
> **Working tree note:** two files carry uncommitted lint-style fixes
> (`app/_lib/actions.ts`, `app/_lib/editor-rules.ts` — non-null assertions →
> optional chaining). Keep them; fold into the next commit. One of them
> introduced a wrong fallback: `editor-rules.ts` `heading[1]?.length ?? 0`
> renders `<h0>` if the group were ever absent — unreachable today, but the
> default should be `1`, not `0`.

## Verified health (all green as of review)

`tsc --noEmit` ✓ · `vitest run` 4 files / 25 tests ✓ · monorepo ESLint (incl.
SDK boundary rule) ✓ · prettier ✓. **Green CI is misleading here** — see P1-1:
two of the four test files exercise dead code.

## What is genuinely good — do not regress

- **Tenant scoping is airtight.** Every query on every table filters
  `tenant_id` (+ `user_id` where user-scoped). Membership/role checks
  (`requireProjectRole`) guard every action. Last-owner demotion/removal is
  protected.
- **Secrets discipline.** PATs go into the platform vault via `sdk.secrets.*`;
  only `secretRef` is stored in plugin tables; PAT input is `type="password"`;
  publish errors are sanitized (`Bearer [redacted]`); GitHub error bodies are
  never echoed (status-code → fixed message map).
- **Conflict-detection design** (baseSha compare before publish) is sound.
- **Schema conventions**: `plainwrite_` prefix, `tenant_id` everywhere, both
  SQLite and Postgres migrations present, drizzle sqlite-typed `Db` cast
  matches the platform pattern (sovereign-tasks does the same).
- **Markdown preview is escape-first** (`escapeHtml` before injecting its own
  tags) — the `dangerouslySetInnerHTML` in `MarkdownEditor.tsx` is safe as
  written. CSS is 100% `--sv-*` tokens for colours.
- Danger-zone delete requires typed `DELETE`; hard-delete also cleans vault
  entries and all child rows.

---

## Findings

### P0 — data loss: editor silently replaces real content with a template

`app/_lib/actions.ts` `getEditorState` (~line 410–435): the remote-fetch
`catch` falls back to `defaultMarkdownTemplate(path)` with
`baseSha: cached?.sha ?? null`. Any transient failure (GitHub down, rate
limit, expired token) while opening an **existing** file shows the user
"Start writing here." instead of the real content — indistinguishable from a
new file. If they save and publish: `assertNoPublishConflict` compares
`remote.sha === draft.baseSha`, the cached sha still matches (the remote file
didn't change), so the publish **succeeds and overwrites the real file** with
template-derived content. The editor page (`editor/[...filePath]/page.tsx`)
compounds it by `.catch(() => null)` → `notFound()`, masking the distinction
further.

**Fix:** only fall back to the template when the provider *definitively*
reports the file does not exist (404-mapped message); every other error
renders an explicit "couldn't load remote content — retry" state and must
never produce a publishable draft. Distinguish "new file" from "load failed"
in `EditorState.status`. Add a regression test (mock provider throwing
rate-limit vs not-found).

### P1 — high

1. **Dead parallel implementation tree, and the tests test the dead copy.**
   `lib/providers/github.ts` and `lib/ssg/astro.ts` are the PLW-001
   placeholder implementations, superseded by the live
   `app/_lib/git-providers.ts` / `app/_lib/ssg-adapters.ts` (nothing under
   `app/` imports from `lib/`). But `lib/__tests__/github-provider.test.ts`
   and `astro-adapter.test.ts` still import the **dead copies** — 2 of the 4
   green test files prove nothing about shipped code, while the live provider
   and adapter have **zero coverage**. (`lib/project-rules.ts` was correctly
   shimmed to re-export the live module; the other two were not.)
   **Fix:** delete `lib/providers/` + `lib/ssg/` (or shim like project-rules),
   port both test files to target `app/_lib/git-providers.ts` /
   `app/_lib/ssg-adapters.ts`, and update `vitest.config.ts` includes. Check
   `SPEC.md`'s directory-structure section and amend it if it still mandates
   `lib/` (the runtime-mount constraint documented in `app/_db/schema.ts` is
   the reason the code moved).

2. **Disconnect fails hard if the vault entry is already gone.**
   `disconnectGitHubCredential` calls `sdk.secrets.delete(existing.secretRef)`
   with no try/catch — if the secret was revoked/deleted out-of-band (admin
   vault cleanup), disconnect throws and the user can *never* disconnect.
   `hardDeleteProject` already wraps the same call in try/catch; mirror that.

3. **Orphaned vault secrets on reconnect.** `connectGitHubPat` reuses the
   existing secret only when `status === 'connected'`; reconnecting from
   `needs_reauth` (the common recovery path) creates a **new** vault entry and
   abandons the old one — vault grows unbounded with dead credentials.
   **Fix:** also reuse/update when a valid non-revoked `secretRef` exists
   regardless of status, or delete the old entry before creating the new one.

### P2 — moderate (security posture / correctness)

1. **No path-scope enforcement for edits and publishes.** The editor
   catch-all accepts any repo path (`filePath.join('/')`), and
   `upsertDraft`/`publishCommittedDraft` never validate the path against the
   project's `pathPrefix` or an extension allowlist — an editor-role member
   can create and publish e.g. `.github/workflows/x.yml` through Plainwrite.
   Not privilege escalation (the publish uses their own PAT), but it defeats
   the product's own scoping model and the audit trail's intent. Note the
   asymmetry: `listContentFiles` only ever *lists* `pathPrefix`-scoped
   `.md/.mdx` (via the Astro adapter), so out-of-scope edits are invisible in
   the UI afterwards. **Fix:** validate in `getEditorState`, `upsertDraft`,
   and `publishCommittedDraft`: path must be within `pathPrefix/`, no `..`
   segments, extension in the adapter's allowlist. This is PLW-017 territory —
   pull this slice forward.

2. **Manifest over-declaration.** `manifest.json` declares
   `notifications:send`, `data:provide/export/import`, `activity:write`, three
   `data.provides` contracts, and the GitHub OAuth connection provider — none
   implemented (`grep` finds zero uses; the OAuth callback route is a 501 stub
   for PLW-009). Declared-but-dead surface misleads admins reviewing
   permissions at install time, and declared data contracts with no resolver
   will break consumers that discover them. **Fix (choose one):** trim the
   manifest to what v0.1 actually uses (`auth:session`, `db:readWrite`) and
   re-add per task; or implement PLW-010 before any release. Either way the
   OAuth `connections.providers` block should be removed or clearly gated
   until PLW-009 lands.

3. **Member invite takes a raw user-ID string.** `inviteProjectMember` inserts
   whatever `userId` string is typed into the settings form — no existence
   check against `sdk.directory` (which is available and already used in
   `getProject`), no self-demotion guard beyond owner-count, no notification
   (permission declared). Typo → phantom member row. **Fix:** resolve the id
   via `sdk.directory` before insert (reject unknown); longer-term use a
   directory picker UI.

4. **No fetch timeout in the GitHub provider.** `fetchGitHubJson` has no
   `AbortSignal` — a hung GitHub connection hangs the server action (and the
   user's form submit) indefinitely. Add `AbortSignal.timeout(~10s)`. While
   there: send `X-GitHub-Api-Version: 2022-11-28`, and handle the contents-API
   1 MB file limit (`encoding: "none"`) with a clear "file too large" error
   instead of the generic base64 failure.

### P3 — conventions / UX / polish

1. **tsconfig doesn't extend `@sovereignfs/tsconfig`** (hard platform rule:
   every package extends `base`/`nextjs`/`library`). It hand-rolls the full
   config and omits the workspace devDependency. Port to
   `"extends": "@sovereignfs/tsconfig/nextjs.json"` + local include/paths.
2. **`package.json` ignores the pnpm catalog** — `next`, `react`, `react-dom`,
   `@types/react*`, `typescript` are literal ranges; other plugins use
   `"catalog:"`. Align to prevent version drift (this is exactly what the
   catalog exists for).
3. **Breakpoint zoo.** Five ad-hoc mobile breakpoints (1040, 920, 720×5, 700,
   560×2) vs the platform's canonical 768 (see the platform monorepo's
   `docs/design-system.md`).
   Consolidate to 768 (or a documented plugin-local value like tasks' 640 —
   but one value, documented, not five).
4. **Raw HTML form controls throughout** (`<input>`, `<select>`, `<textarea>`,
   `<button>` in `MarkdownEditor`, `NewProjectDialog`, settings page, project
   page) instead of DS `Input`/`Select`/`Textarea`/`Button`/`Checkbox`/
   `FormField`. Violates the plugin UI rule ("consume `@sovereignfs/ui`
   exclusively") and silently loses the DS's touch/a11y/dark-mode behaviour —
   including the A2 touch-hygiene work, which only auto-covers element
   selectors, not the DS components' richer states.
5. **`NewProjectDialog` can't be dismissed.** Its `handleDialogClose` refuses
   to close while focus is inside the form — but `Dialog` focuses the first
   form field on open, so Esc/scrim-click effectively never work; only Cancel
   does. If the intent was "don't lose form input", implement a dirty-check
   confirm instead of silently swallowing dismissals.
6. **Editor has no unsaved-changes protection.** Draft state lives in
   `useState`; navigating away (sidebar links, back) or closing the tab loses
   edits silently. Add dirty tracking + `beforeunload` + (when available) the
   platform's ConfirmDialog on in-app nav. For a writing tool this is the #1
   trust feature; consider debounced autosave-as-draft (SPEC's PLW-006 editor
   task is still open — fold it there).
7. **`window.confirm` for discard-draft** (`MarkdownEditor.tsx`) — non-native
   feel in the PWA; replace with the native `<dialog>` pattern used elsewhere
   or the DS `ConfirmDialog` when Phase B of
   the platform monorepo's `docs/adhoc/mobile-design-system-improvement-plan.md`
   ships it.
8. **Mobile is a squeeze, not a design.** `layout.module.css` collapses the
   project sidebar above the content at ≤720px; the editor stacks three dense
   panels. Fine for v0.1 scaffolding, but flag: when the DS Phase B surfaces
   (Sheet, OverlayHeader, adaptive Menu) land, Plainwrite should adopt the
   same mobile taxonomy as tasks rather than inventing its own. DS-first —
   don't build plugin-local overlays here.
9. **`refreshProjectContentCache` is delete-then-insert without a
   transaction** — two concurrent syncs can race into unique-index errors, and
   a crash between the statements empties the cache until the next TTL sync.
   Low impact (self-healing), but wrap in a transaction when the SDK client
   exposes one, or tolerate conflict errors explicitly.
10. **Silent catches worth softening:** `getProject`'s directory lookup and
    `listContentFiles`' auto-refresh both swallow all errors (the latter has a
    comment). Acceptable, but attach a `lastError`-style surface (the
    credential row already has one) so failures are visible somewhere.

---

## Fix plan (suggested order, one branch/PR each in the plugin repo)

| # | Branch | Contents | Bump |
| - | ------ | -------- | ---- |
| 1 | `fix/editor-remote-load-fallback` | P0 + P2-4 (timeout makes transient failures rarer; the P0 fix makes them safe). Regression tests for not-found vs transient-error. Commit the pending working-tree lint fixes here too (with the `?? 1` correction). | patch |
| 2 | `chore/remove-dead-lib-tree` | P1-1: delete/shim dead `lib/` code, port the two test files to the live modules, update `vitest.config.ts`, amend SPEC directory section. No behaviour change. | none |
| 3 | `fix/credential-lifecycle` | P1-2 + P1-3 + the pending PLW-004 credential tests (roadmap already owes them). | patch |
| 4 | `fix/path-scope-enforcement` | P2-1: pathPrefix + extension + `..` validation across editor state, drafts, publish. Tests. (Pull-forward slice of PLW-017.) | patch |
| 5 | `chore/manifest-permission-trim` | P2-2: trim manifest to used permissions; drop/gate OAuth provider block until PLW-009; note in roadmap. | none (manifest change — re-validate against platform schema) |
| 6 | `fix/invite-directory-validation` | P2-3: validate invitee via `sdk.directory`. | patch |
| 7 | `chore/platform-conventions` | P3-1 + P3-2 (tsconfig extends, catalog versions). Verify typecheck/build in the monorepo mount after. | none |
| 8 | `fix/editor-ux-guardrails` | P3-5 + P3-6 + P3-7 (dialog dismissal, dirty tracking + beforeunload, confirm pattern). | patch |
| 9 | `chore/breakpoint-and-ds-controls` | P3-3 + P3-4: one breakpoint, DS form controls. Coordinate with DS Phase B (ConfirmDialog/Sheet) — don't hand-roll what B is about to ship. | none/patch |

Items P3-8/9/10 ride along where they fit or wait for DS Phase B / PLW-017.

## Verification per task

- `pnpm typecheck` + `pnpm test` in the plugin, plus monorepo `pnpm lint`
  (SDK boundary) and `pnpm format:check` from the platform root.
- Task 1 additionally: manual check — open an existing file with the provider
  mocked to fail transiently → editor must show the retry state, never the
  template; publish must be impossible from that state.
- Task 5: re-validate `manifest.json` against `packages/manifest` schema
  (platform `pnpm test` covers the validator; the generate step consumes it).
- Nothing is committed or pushed without the developer's explicit go-ahead
  (standing instruction for this working session).
