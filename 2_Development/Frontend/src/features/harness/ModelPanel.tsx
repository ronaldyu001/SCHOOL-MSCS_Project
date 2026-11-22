import { useState } from 'react'
import { Button, Icon, TextField } from '@/components/ui'
import type { Model } from './useModel'
import styles from './ModelPanel.module.css'

/**
 * A pinned revision is usually a 40-character commit SHA, which is longer than
 * the model id it qualifies and would otherwise be the widest thing on the
 * line. Shortened like a git hash, with the whole value on hover and in the
 * accessible name.
 */
function shortRevision(revision: string) {
  return /^[0-9a-f]{12,}$/i.test(revision) ? revision.slice(0, 7) : revision
}

/**
 * The checkpoint this session runs against, stated where the runs are started.
 *
 * It used to be two text fields at the bottom of a collapsed "Options" panel,
 * once on each page, with a hint that said "blank uses the default" without
 * ever saying what the default was. The setting existed; nobody could find it,
 * and nothing told you which model had answered. This keeps the active
 * checkpoint permanently on screen and puts the editing one click away.
 */
export function ModelPanel({ model, busy }: { model: Model; busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const { info } = model

  return (
    <section className={styles.panel} aria-label="Model">
      <div className={styles.summary}>
        <span className={styles.label}>Model</span>

        <span className={styles.name}>
          {model.activeId ?? 'Checking…'}
          {model.activeRevision ? (
            <span className={styles.revision} title={model.activeRevision}>
              @{shortRevision(model.activeRevision)}
            </span>
          ) : null}
        </span>

        {model.isDefault ? (
          <span className={styles.badge}>default</span>
        ) : (
          <span className={`${styles.badge} ${styles.custom}`}>custom</span>
        )}

        <Button
          size="sm"
          variant="ghost"
          icon="chevron"
          className={open ? styles.openToggle : undefined}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Done' : 'Change'}
        </Button>
      </div>

      {info ? (
        <p className={styles.harness}>
          {info.loaded_model_id === null
            ? 'Nothing loaded yet — the first run loads the weights.'
            : `${info.loaded_model_id} loaded on ${info.llm_device}.`}{' '}
          {info.embedding_model} for search · collection {info.qdrant_collection}
        </p>
      ) : null}

      {model.swaps ? (
        <p className={styles.swap} role="status">
          <Icon name="alert" size={13} />
          The next run unloads {info?.loaded_model_id} and loads this one, which takes a
          while and happens again if you switch back.
        </p>
      ) : null}

      {open ? (
        <div className={styles.editor}>
          <div className={styles.fields}>
            <TextField
              label="Hugging Face model"
              placeholder={info?.default_model_id ?? 'owner/model'}
              value={model.modelId}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => model.setModelId(event.target.value)}
              hint={
                info
                  ? `Blank uses the default, ${info.default_model_id}.`
                  : 'Blank uses the default.'
              }
            />
            <TextField
              label="Revision"
              placeholder={model.isDefault ? (info?.default_revision ?? '') : 'main'}
              value={model.revision}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => model.setRevision(event.target.value)}
              hint="A branch, tag or commit. Blank tracks the latest."
            />
          </div>

          <p className={styles.note}>
            A Hub id such as <code>Qwen/Qwen2.5-0.5B</code>. Local paths are not
            accepted, and the id is only checked when a run starts.
          </p>

          <div className={styles.actions}>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || model.isDefault}
              onClick={model.reset}
            >
              Use the default
            </Button>
            <Button size="sm" icon="refresh" onClick={() => void model.refresh()}>
              Re-check what's loaded
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
