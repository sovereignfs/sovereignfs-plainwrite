import { notFound } from 'next/navigation';
import { Badge, PageHeader, StatusBadge } from '@sovereignfs/ui';
import {
  archiveProject,
  connectGitHubPat,
  disconnectGitHubCredential,
  getGitHubOAuthStatus,
  getProject,
  hardDeleteProject,
  inviteProjectMember,
  listCollectionSchemas,
  removeProjectMember,
  resetCollectionSchema,
  restoreProject,
  startGitHubOAuth,
  updateCollectionSchema,
  updateProjectSettings,
} from '../../_lib/actions';
import { canEditProject, canManageProject } from '../../_lib/project-rules';
import styles from './settings.module.css';

interface SettingsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectSettingsPage({ params }: SettingsPageProps) {
  const { projectId } = await params;
  const [project, schemas, oauthStatus] = await Promise.all([
    getProject(projectId).catch(() => null),
    listCollectionSchemas(projectId).catch(() => []),
    getGitHubOAuthStatus(projectId).catch(() => null),
  ]);
  if (!project) notFound();
  const userCanEdit = canEditProject(project.currentUserRole);
  const userCanManage = canManageProject(project.currentUserRole);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Project settings"
        description={`Membership and repository settings for ${project.name}.`}
        action={
          <Badge variant="status" status={userCanManage ? 'active' : 'neutral'}>
            {project.currentUserRole}
          </Badge>
        }
      />

      <section className={styles.panel} aria-labelledby="repository-settings">
        <h2 id="repository-settings">Repository</h2>
        <form action={updateProjectSettings.bind(null, project.id)} className={styles.form}>
          <label>
            <span>Name</span>
            <input name="name" required defaultValue={project.name} disabled={!userCanManage} />
          </label>
          <label>
            <span>Description</span>
            <textarea
              name="description"
              rows={2}
              defaultValue={project.description ?? ''}
              disabled={!userCanManage}
            />
          </label>
          <div className={styles.grid}>
            <label>
              <span>Branch</span>
              <input name="branch" defaultValue={project.branch} disabled={!userCanManage} />
            </label>
            <label>
              <span>Path prefix</span>
              <input name="pathPrefix" defaultValue={project.pathPrefix} disabled={!userCanManage} />
            </label>
            <label>
              <span>SSG</span>
              <select name="ssgType" defaultValue={project.ssgType} disabled={!userCanManage}>
                <option value="astro">Astro</option>
              </select>
            </label>
            <label>
              <span>Metadata</span>
              <select
                name="metadataVisibility"
                defaultValue={project.metadataVisibility}
                disabled={!userCanManage}
              >
                <option value="members_with_credentials">Members with credentials</option>
                <option value="all_members">All members</option>
              </select>
            </label>
          </div>
          <label className={styles.checkbox}>
            <input
              name="isPrivate"
              type="checkbox"
              defaultChecked={project.isPrivate}
              disabled={!userCanManage}
            />
            <span>Private repository</span>
          </label>
          {userCanManage ? <button type="submit">Save settings</button> : null}
        </form>
      </section>

      <section className={styles.panel} aria-labelledby="github-credential">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="github-credential">GitHub credential</h2>
            <p className={styles.panelDescription}>
              Connect GitHub OAuth when configured, or use a personal access token fallback.
            </p>
          </div>
          <StatusBadge status={project.credential?.status === 'connected' ? 'synced' : 'warning'}>
            {project.credential?.status === 'connected' ? 'Connected' : 'Not connected'}
          </StatusBadge>
        </div>

        {project.credential ? (
          <dl className={styles.credentialDetails}>
            <div>
              <dt>Provider</dt>
              <dd>GitHub</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{project.credential.providerLogin ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Auth type</dt>
              <dd>{project.credential.authType.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Connection</dt>
              <dd>{project.credential.connectionId ? 'Platform-managed' : 'Plainwrite token'}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatTimestamp(project.credential.updatedAt)}</dd>
            </div>
          </dl>
        ) : null}

        {project.credential?.lastError ? (
          <p className={styles.errorText}>{project.credential.lastError}</p>
        ) : null}

        {userCanEdit ? (
          <div className={styles.credentialForms}>
            {oauthStatus?.configured ? (
              <form action={startGitHubOAuth.bind(null, project.id)} className={styles.form}>
                <p className={styles.helpText}>
                  GitHub OAuth is configured for this instance. Authorization opens GitHub and
                  stores the returned token in the platform secret vault.
                </p>
                <button type="submit">
                  {project.credential?.authType === 'oauth' ? 'Reconnect GitHub' : 'Connect GitHub'}
                </button>
              </form>
            ) : (
              <p className={styles.helpText}>
                GitHub OAuth is not configured for this instance. PAT fallback remains available.
              </p>
            )}

            <form action={connectGitHubPat.bind(null, project.id)} className={styles.form}>
              <label>
                <span>Personal access token</span>
                <input
                  name="token"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="github_pat_..."
                />
              </label>
              <p className={styles.helpText}>
                Use a fine-grained token with contents read/write access for
                {` ${project.repoOwner}/${project.repoName}`}. The token is stored in the platform
                secret vault and is never saved in Plainwrite tables.
              </p>
              <button type="submit">
                {project.credential?.status === 'connected' ? 'Reconnect token' : 'Connect token'}
              </button>
            </form>

            {project.credential?.status === 'connected' ? (
              <form action={disconnectGitHubCredential.bind(null, project.id)}>
                <button type="submit" className={styles.secondaryButton}>
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
        ) : (
          <p className={styles.helpText}>Viewers cannot connect publishing credentials.</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="collection-schemas">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="collection-schemas">Collection schemas</h2>
            <p className={styles.panelDescription}>
              Inferred frontmatter fields stay editable by project owners.
            </p>
          </div>
          <StatusBadge status={schemas.length > 0 ? 'synced' : 'warning'}>
            {schemas.length > 0 ? `${schemas.length} collections` : 'Not inferred'}
          </StatusBadge>
        </div>

        {schemas.length > 0 ? (
          <div className={styles.schemaList}>
            {schemas.map((schema) => (
              <form
                key={schema.collection}
                action={updateCollectionSchema.bind(null, project.id, schema.collection)}
                className={styles.schemaCard}
              >
                <div className={styles.panelHeader}>
                  <div>
                    <h3>{schema.collection}</h3>
                    <p className={styles.panelDescription}>
                      {schema.isManual ? 'Manual schema' : 'Inferred schema'}
                    </p>
                  </div>
                  {userCanManage ? (
                    <button
                      type="submit"
                      formAction={resetCollectionSchema.bind(null, project.id, schema.collection)}
                      className={styles.secondaryButton}
                    >
                      Reset
                    </button>
                  ) : null}
                </div>
                <div className={styles.schemaFields}>
                  {[...schema.fields, { name: '', type: 'string' as const, required: false }].map(
                    (field, index) => (
                      <div key={`${schema.collection}-${index}`} className={styles.schemaField}>
                        <label>
                          <span>Name</span>
                          <input name="fieldName" defaultValue={field.name} disabled={!userCanManage} />
                        </label>
                        <label>
                          <span>Type</span>
                          <select name="fieldType" defaultValue={field.type} disabled={!userCanManage}>
                            <option value="string">Text</option>
                            <option value="date">Date</option>
                            <option value="number">Number</option>
                            <option value="boolean">Toggle</option>
                            <option value="array">Tags</option>
                          </select>
                        </label>
                        <label className={styles.checkbox}>
                          <input
                            name="fieldRequired"
                            value={String(index)}
                            type="checkbox"
                            defaultChecked={field.required}
                            disabled={!userCanManage}
                          />
                          <span>Required</span>
                        </label>
                      </div>
                    ),
                  )}
                </div>
                {userCanManage ? <button type="submit">Save schema</button> : null}
              </form>
            ))}
          </div>
        ) : (
          <p className={styles.helpText}>Run content sync to infer schemas from existing files.</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="members">
        <div className={styles.panelHeader}>
          <h2 id="members">Members</h2>
          <StatusBadge status="unmodified">{project.members.length} total</StatusBadge>
        </div>
        <div className={styles.members}>
          {project.members.map((member) => (
            <div key={member.userId} className={styles.member}>
              <div>
                <strong>{member.displayName ?? member.email ?? member.userId}</strong>
                <p>{member.email ?? member.userId}</p>
              </div>
              <StatusBadge status="unmodified">{member.role}</StatusBadge>
              {userCanManage ? (
                <form action={removeProjectMember.bind(null, project.id, member.userId)}>
                  <button type="submit">Remove</button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
        {userCanManage ? (
          <form action={inviteProjectMember.bind(null, project.id)} className={styles.inlineForm}>
            <label>
              <span>User ID</span>
              <input name="userId" required />
            </label>
            <label>
              <span>Role</span>
              <select name="role" defaultValue="viewer">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <button type="submit">Add member</button>
          </form>
        ) : null}
      </section>

      {userCanManage ? (
        <section className={styles.panel} aria-labelledby="danger-zone">
          <h2 id="danger-zone">Project state</h2>
          <div className={styles.actions}>
            {project.archivedAt ? (
              <form action={restoreProject.bind(null, project.id)}>
                <button type="submit">Restore project</button>
              </form>
            ) : (
              <form action={archiveProject.bind(null, project.id)}>
                <button type="submit">Archive project</button>
              </form>
            )}
            <form action={hardDeleteProject.bind(null, project.id)} className={styles.deleteForm}>
              <label>
                <span>Type DELETE to permanently delete</span>
                <input name="confirm" />
              </label>
              <button type="submit">Delete permanently</button>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value * 1000));
}
