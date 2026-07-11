import Link from 'next/link';
import { Card, EmptyState, PageHeader, StatusBadge } from '@sovereignfs/ui';
import { NewProjectDialog } from './_components/NewProjectDialog';
import { listProjects, type ProjectListItem } from './_lib/actions';
import { formatPipelineSummary, formatProjectRole } from './_lib/copy';
import styles from './page.module.css';

export default async function ProjectsPage() {
  const [projects, allProjects] = await Promise.all([
    listProjects(),
    listProjects({ includeArchived: true }),
  ]);
  const archivedProjects = allProjects.filter((project) => project.archivedAt !== null);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Your sites"
        description="Write and publish content for your sites."
        action={<NewProjectDialog />}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon="pencil"
          heading="Connect your first site"
          description="Plainwrite turns your website's content into a simple writing space. Connect a site to start writing and publishing — or ask a site owner to add you if you're joining one."
        />
      ) : (
        <section className={styles.projectGrid} aria-label="Active sites">
          {projects.map((project) => (
            <SiteCard key={project.id} project={project} />
          ))}
        </section>
      )}

      {archivedProjects.length > 0 ? (
        <section className={styles.archivedList} aria-label="Archived sites">
          <p className={styles.archivedHeading}>
            {archivedProjects.length} archived {archivedProjects.length === 1 ? 'site' : 'sites'}
          </p>
          {archivedProjects.map((project) => (
            <Link
              key={project.id}
              href={`/plainwrite/${project.id}/settings`}
              className={styles.archivedRow}
            >
              <span>{project.name}</span>
              <StatusBadge status="conflict">Archived</StatusBadge>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function SiteCard({ project }: { project: ProjectListItem }) {
  return (
    <Link href={`/plainwrite/${project.id}`} className={styles.cardLink}>
      <Card interactive className={styles.projectCard}>
        <div className={styles.cardHeader}>
          <h2>{project.name}</h2>
          <span
            className={project.needsAttention ? styles.dotWarning : styles.dotOk}
            aria-hidden="true"
          />
        </div>
        <p className={styles.projectMeta}>
          {project.repoOwner}/{project.repoName}
        </p>
        {project.needsAttention ? (
          <p className={styles.attentionText}>Publishing access expired — reconnect</p>
        ) : (
          <p className={styles.pipelineText}>{formatPipelineSummary(project)}</p>
        )}
        <div className={styles.cardFooter}>
          <span>{formatProjectRole(project.currentUserRole)}</span>
        </div>
      </Card>
    </Link>
  );
}
