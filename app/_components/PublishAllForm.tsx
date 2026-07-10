'use client';

import { useActionState, useEffect, useState } from 'react';
import { Button, Dialog } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/actions';
import { FormCheckbox } from './FormCheckbox';
import styles from './PublishAllForm.module.css';

interface ReadyPost {
  path: string;
  filename: string;
}

/**
 * Replaces the bare "Publish all" + "Skip conflicts" checkbox with a
 * confirmation that lists exactly what's about to go live, per
 * docs/adhoc/plainwrite-ui-redesign.md §4.9. There's no true conflict
 * preflight yet (that's phase 4's "Conflict review" work) — skipped
 * conflicts are still resolved server-side and surfaced afterward via the
 * action's success message.
 */
export function PublishAllForm({
  action,
  readyPosts,
}: {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  readyPosts: ReadyPost[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const readyCount = readyPosts.length;
  const postWord = readyCount === 1 ? 'post' : 'posts';

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <div>
      <Button type="button" disabled={readyCount === 0} onClick={() => setOpen(true)}>
        {readyCount > 0 ? `Put ${readyCount} live` : 'Nothing ready yet'}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={`Put ${readyCount} ${postWord} on your site`}
      >
        <div className={styles.body}>
          <p className={styles.intro}>They&apos;ll be visible to anyone who visits your site.</p>
          <ul className={styles.list}>
            {readyPosts.map((post) => (
              <li key={post.path}>{post.filename}</li>
            ))}
          </ul>
          <form action={formAction} className={styles.form}>
            <FormCheckbox name="skipConflicts" label="Skip posts that changed on the site" />
            {state && !state.ok ? (
              <p className={styles.feedbackError} role="status" aria-live="polite">
                {state.error}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Publishing…' : `Publish ${readyCount} ${postWord}`}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>
      {state && state.ok && state.message ? <p className={styles.successNote}>{state.message}</p> : null}
    </div>
  );
}
