import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@sovereignfs/ui';
import { MarkdownEditor } from '../../../_components/MarkdownEditor';
import {
  commitDraft,
  discardDraft,
  getEditorState,
  publishCommittedDraft,
  saveDraft,
} from '../../../_lib/actions';
import { parseMarkdownDocument } from '../../../_lib/editor-rules';
import { canEditProject } from '../../../_lib/project-rules';
import styles from './page.module.css';

interface EditorPageProps {
  params: Promise<{ projectId: string; filePath: string[] }>;
  searchParams: Promise<{ title?: string }>;
}

export default async function EditorPage({ params, searchParams }: EditorPageProps) {
  const { projectId, filePath } = await params;
  const { title: newFileTitle } = await searchParams;
  const path = filePath.join('/');
  // Project-not-found / access-denied still 404; a remote load failure is
  // surfaced explicitly via editor.loadError instead of being swallowed here,
  // so it never gets mistaken for "this is a new file". newFileTitle only
  // affects a genuinely new path with no existing draft (see getEditorState) —
  // it's a one-time seed from the "New post" dialog, not persisted state.
  const editor = await getEditorState(projectId, path, newFileTitle).catch(() => null);
  if (!editor) notFound();
  const userCanEdit = canEditProject(editor.currentUserRole);
  const repositoryLabel = `${editor.project.repoOwner}/${editor.project.repoName}`;
  const frontmatterTitle = editor.loadError
    ? undefined
    : parseMarkdownDocument(editor.content).data.title;
  const displayTitle =
    typeof frontmatterTitle === 'string' && frontmatterTitle.trim() ? frontmatterTitle : path;

  return (
    <div className={styles.page}>
      <PageHeader
        title={displayTitle}
        description={`${editor.project.name} · ${repositoryLabel} · ${editor.project.branch}`}
      />

      {editor.loadError ? (
        <section className={styles.toolbar} role="alert">
          <div>
            <p className={styles.eyebrow}>Couldn&apos;t load this post</p>
            <p>{editor.loadError}</p>
          </div>
          <div className={styles.toolbarActions}>
            <Link href={`/plainwrite/${projectId}/editor/${path}`}>Retry</Link>
            <Link href={`/plainwrite/${projectId}`}>Back to posts</Link>
          </div>
        </section>
      ) : (
        <>
          <section className={styles.toolbar} aria-label="Editor actions">
            <div>
              <p className={styles.eyebrow}>Status</p>
              <p>{editor.baseSha ? 'Synced from your site' : 'New post — not on your site yet'}</p>
            </div>
            <div className={styles.toolbarActions}>
              <Link href={`/plainwrite/${projectId}`}>Back to posts</Link>
            </div>
          </section>

          <MarkdownEditor
            path={path}
            content={editor.content}
            baseSha={editor.baseSha}
            status={editor.status}
            commitMessage={editor.commitMessage}
            userCanEdit={userCanEdit}
            schemaFields={editor.schemaFields}
            saveAction={saveDraft.bind(null, projectId, path)}
            commitAction={commitDraft.bind(null, projectId, path)}
            publishAction={publishCommittedDraft.bind(null, projectId, path)}
            discardAction={discardDraft.bind(null, projectId, path)}
          />
        </>
      )}
    </div>
  );
}
