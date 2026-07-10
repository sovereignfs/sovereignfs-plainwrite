import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, NavTabs, PageHeader, StatusBadge } from '@sovereignfs/ui';
import {
  getProject,
  listContentFiles,
  publishAllCommittedDrafts,
  stageContentDeletion,
  syncProjectContent,
} from '../_lib/actions';
import { NewPostDialog } from '../_components/NewPostDialog';
import { PublishAllForm } from '../_components/PublishAllForm';
import { SyncContentForm } from '../_components/SyncContentForm';
import { groupContentFiles } from '../_lib/content-rules';
import { formatPostStatus, formatProjectRole } from '../_lib/copy';
import { canEditProject, canManageProject } from '../_lib/project-rules';
import styles from './page.module.css';

interface ProjectPageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ status?: string }>;
}

const PIPELINE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Writing' },
  { key: 'committed', label: 'Ready to publish' },
  { key: 'unmodified', label: 'Live on site' },
] as const;

type PipelineTabKey = (typeof PIPELINE_TABS)[number]['key'];

export default async function ProjectPage({ params, searchParams }: ProjectPageProps) {
  const { projectId } = await params;
  const { status } = await searchParams;
  const activeTab: PipelineTabKey = PIPELINE_TABS.some((tab) => tab.key === status)
    ? (status as PipelineTabKey)
    : 'all';

  const [project, contentFileList] = await Promise.all([
    getProject(projectId).catch(() => null),
    listContentFiles(projectId).catch(() => ({ files: [], syncError: null })),
  ]);
  if (!project) notFound();
  const { files: contentFiles, syncError: contentSyncError } = contentFileList;
  const userCanEdit = canEditProject(project.currentUserRole);
  const userCanManage = canManageProject(project.currentUserRole);
  const repositoryLabel = `${project.repoOwner}/${project.repoName}`;
  const readyPosts = contentFiles
    .filter((file) => file.status === 'committed')
    .map((file) => ({ path: file.path, filename: file.filename }));
  const sections = [...new Set(contentFiles.map((file) => file.collection).filter(Boolean))].sort() as string[];

  const visibleFiles =
    activeTab === 'all' ? contentFiles : contentFiles.filter((file) => file.status === activeTab);
  const contentGroups = groupContentFiles(visibleFiles);
  const tabItems = PIPELINE_TABS.map((tab) => {
    const count =
      tab.key === 'all' ? contentFiles.length : contentFiles.filter((f) => f.status === tab.key).length;
    return {
      label: `${tab.label} (${count})`,
      href: tab.key === 'all' ? `/plainwrite/${projectId}` : `/plainwrite/${projectId}?status=${tab.key}`,
      active: activeTab === tab.key,
    };
  });

  return (
    <div className={styles.page}>
      <PageHeader
        title={project.name}
        description={`${repositoryLabel} · ${project.branch}`}
        action={
          <div className={styles.headerActions}>
            <StatusBadge status={project.archivedAt ? 'conflict' : 'unmodified'}>
              {formatProjectRole(project.currentUserRole)}
            </StatusBadge>
            {userCanEdit ? <NewPostDialog projectId={projectId} sections={sections} /> : null}
          </div>
        }
      />

      <section className={styles.actionsPanel} aria-label="Project actions">
        <div>
          <h2>Next actions</h2>
          <p>Check for site updates, put ready posts live, or manage who can write here.</p>
        </div>
        <div className={styles.actions}>
          {userCanEdit ? <SyncContentForm action={syncProjectContent.bind(null, projectId)} /> : null}
          {userCanEdit ? (
            <PublishAllForm action={publishAllCommittedDrafts.bind(null, projectId)} readyPosts={readyPosts} />
          ) : null}
          <Link href={`/plainwrite/${projectId}/settings`}>
            {userCanManage ? 'Manage site' : 'View settings'}
          </Link>
        </div>
      </section>

      <section className={styles.contentPanel} aria-labelledby="content-files">
        <div className={styles.cardHeader}>
          <h2 id="content-files">Posts</h2>
        </div>
        <NavTabs items={tabItems} aria-label="Filter posts by stage" className={styles.pipelineTabs} />
        {contentSyncError ? <p className={styles.syncWarning}>{contentSyncError}</p> : null}
        {contentGroups.length > 0 ? (
          <div className={styles.collections}>
            {contentGroups.map((group) => (
              <section key={group.collection} className={styles.collection}>
                <h3>{group.collection}</h3>
                <div className={styles.fileList}>
                  {group.files.map((file) => (
                    <div key={file.path} className={styles.fileRow}>
                      <Link href={`/plainwrite/${projectId}/editor/${file.path}`}>
                        {file.filename}
                      </Link>
                      <div className={styles.fileActions}>
                        <StatusBadge status={file.status}>{formatPostStatus(file.status)}</StatusBadge>
                        {userCanEdit ? (
                          <form action={stageContentDeletion.bind(null, projectId, file.path)}>
                            <Button type="submit" variant="secondary" disabled={file.status === 'pending-delete'}>
                              Remove
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : contentFiles.length === 0 ? (
          <p className={styles.emptyText}>
            Check for site updates to load your posts. Private sites need publishing access
            connected in settings first.
          </p>
        ) : (
          <p className={styles.emptyText}>No posts in this stage.</p>
        )}
      </section>
    </div>
  );
}
