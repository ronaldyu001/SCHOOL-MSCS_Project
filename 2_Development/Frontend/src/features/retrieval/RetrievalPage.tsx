import { useEffect } from 'react'
import { Link } from 'react-router'
import { Button, Callout } from '@/components/ui'
import { useShell } from '@/app/shell-context'
import { ModelPanel } from '@/features/harness/ModelPanel'
import { ComparisonPanel } from './ComparisonPanel'
import { QueryDetail } from './QueryDetail'
import { QueryPanel } from './QueryPanel'
import styles from './RetrievalPage.module.css'

export function RetrievalPage() {
  // The shell holds this, so a search survives a trip to another tab.
  const { health, retrieval, model } = useShell()

  useEffect(() => {
    document.title = 'Search · Memory Query Rewriter'
  }, [])

  const { rewrite, search } = retrieval

  return (
    <div className={styles.page}>
      <div>
        <h1>Search</h1>
        <p className={styles.lede}>
          Ask a question, see which memories come back, and compare the question as
          written against the rewriter's versions of it.
        </p>
      </div>

      {health.state === 'offline' ? (
        <Callout tone="error" title="Can't reach the backend">
          <Button size="sm" icon="refresh" onClick={() => void health.refresh()}>
            Try again
          </Button>
        </Callout>
      ) : null}

      <ModelPanel model={model} busy={retrieval.busy} />

      <QueryPanel retrieval={retrieval} />

      {rewrite.status === 'running' ? (
        <Callout tone="info" icon="refresh">
          Writing {retrieval.settings.candidates} versions of the question. The first
          run loads the model, so give it a minute.
        </Callout>
      ) : null}

      {rewrite.status === 'failed' ? (
        <Callout tone="error" title="Rewriting failed" role="alert">
          <p>{rewrite.error}</p>
        </Callout>
      ) : null}

      {rewrite.status === 'done' && rewrite.result.queries.length < 2 ? (
        <Callout tone="warn" title="The rewrites all came out the same">
          <p>Turn up Variety or ask for more rewrites to get different wordings.</p>
        </Callout>
      ) : null}

      {search.status === 'running' ? (
        <Callout tone="info" icon="refresh">
          Searching.
        </Callout>
      ) : null}

      {search.status === 'failed' ? (
        <Callout tone="error" title="Search failed" role="alert">
          <p>{search.error}</p>
          <p className={styles.hint}>
            If nothing is indexed any more, <Link to="/setup">set the data up</Link>{' '}
            again.
          </p>
        </Callout>
      ) : null}

      {retrieval.result && search.status === 'done' ? (
        <>
          <ComparisonPanel
            result={retrieval.result}
            focus={retrieval.focus}
            onFocus={retrieval.setFocus}
          />
          <QueryDetail retrieval={retrieval} />
        </>
      ) : null}
    </div>
  )
}
