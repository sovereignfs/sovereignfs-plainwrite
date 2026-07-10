'use client';

import { useMemo, useRef, useState } from 'react';
import { Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import { createContentFile } from '../_lib/actions';
import { ConfirmDialog } from './ConfirmDialog';
import styles from './NewPostDialog.module.css';

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

/**
 * Title-first replacement for the old "Collection + Filename" form — a
 * writer thinks in titles, not filenames. The filename is derived from the
 * title and shown as a muted preview with a "change" escape hatch, matching
 * docs/adhoc/plainwrite-ui-redesign.md §4.5.
 */
export function NewPostDialog({ projectId, sections }: { projectId: string; sections: string[] }) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState(sections[0] ?? '');
  const [filenameOverrideOpen, setFilenameOverrideOpen] = useState(false);
  const [filename, setFilename] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const autoFilename = useMemo(() => `${slugify(title)}.md`, [title]);

  function resetAndClose() {
    formRef.current?.reset();
    setTitle('');
    setSection(sections[0] ?? '');
    setFilenameOverrideOpen(false);
    setFilename('');
    setDirty(false);
    setDiscardConfirmOpen(false);
    setOpen(false);
  }

  function handleDismissRequest() {
    if (!dirty) {
      resetAndClose();
      return;
    }
    setDiscardConfirmOpen(true);
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        + New post
      </Button>
      <Dialog open={open} onClose={handleDismissRequest} size="md" title="New post">
        <form
          ref={formRef}
          action={createContentFile.bind(null, projectId)}
          className={styles.form}
          onChange={() => setDirty(true)}
        >
          <FormField label="Title" required>
            {(field) => (
              <Input
                {...field}
                name="title"
                required
                placeholder="Why we moved to a static site"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            )}
          </FormField>

          {sections.length > 0 ? (
            <FormField label="Section">
              {() => (
                <div className={styles.sectionPills}>
                  {sections.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={option === section ? styles.pillActive : styles.pill}
                      onClick={() => {
                        setSection(option);
                        setDirty(true);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </FormField>
          ) : (
            <FormField label="Section" hint="Where this post lives, e.g. blog">
              {(field) => (
                <Input
                  {...field}
                  name="collection"
                  placeholder="blog"
                  value={section}
                  onChange={(event) => {
                    setSection(event.currentTarget.value);
                    setDirty(true);
                  }}
                />
              )}
            </FormField>
          )}
          {sections.length > 0 ? <input type="hidden" name="collection" value={section} /> : null}

          {filenameOverrideOpen ? (
            <FormField label="Filename">
              {(field) => (
                <Input
                  {...field}
                  name="filename"
                  required
                  placeholder={autoFilename}
                  value={filename}
                  onChange={(event) => setFilename(event.currentTarget.value)}
                />
              )}
            </FormField>
          ) : (
            <>
              <input type="hidden" name="filename" value={autoFilename} />
              <p className={styles.filenameHint}>
                Will be saved as{' '}
                <code>
                  {section ? `${section}/` : ''}
                  {autoFilename}
                </code>
                {' · '}
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => {
                    setFilenameOverrideOpen(true);
                    setFilename(autoFilename);
                  }}
                >
                  change
                </button>
              </p>
            </>
          )}

          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={handleDismissRequest}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Start writing
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={discardConfirmOpen}
        title="Discard this post?"
        message="The details you've entered will be lost."
        confirmLabel="Discard"
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={resetAndClose}
      />
    </>
  );
}
