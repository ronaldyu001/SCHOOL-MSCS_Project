import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  answerQuestion,
  listQuestions,
  rewriteQuery,
  searchMemories,
  type AnswerResponse,
  type DatasetQuestion,
  type Partition,
  type RewriteResponse,
  type SearchResponse,
} from '@/lib/api'
import { useAsyncRun, resultOf } from '@/lib/useAsyncRun'
import type { ShellData } from '@/app/shell-context'

/** Budgets offered as a sweep. Powers of two, as the evaluation ladder uses. */
export const BUDGET_CHOICES = [128, 256, 512, 1024, 2048] as const

/**
 * One search compares at most eight queries, and the raw message always takes
 * the first place. Capping the control at seven keeps the comparison complete
 * rather than quietly dropping the candidates that would not fit.
 */
export const MAX_QUERIES = 8
export const MAX_CANDIDATES = MAX_QUERIES - 1

export type RetrievalSettings = {
  conversationId: string
  text: string
  topK: number
  budgets: number[]
  /** Free text: ids separated by commas, semicolons, spaces or newlines. */
  expectedTurnIds: string
  candidates: number
  temperature: number
  rewriteMaxTokens: number
  seed: number
  answerMaxTokens: number
}

const DEFAULTS: RetrievalSettings = {
  conversationId: '',
  text: '',
  topK: 20,
  budgets: [128, 256, 512, 1024],
  expectedTurnIds: '',
  candidates: 4,
  temperature: 0.7,
  rewriteMaxTokens: 48,
  seed: 123,
  answerMaxTokens: 64,
}

export function parseTurnIds(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Conversation ids this session can search.
 *
 * Read from the shared workspace rather than fetched again here. The pipeline
 * result is preferred when this browser just ran it, because that is the
 * partition the user is thinking about.
 */
function useKnownConversations({ pipeline, workspace }: ShellData) {
  const split = resultOf(pipeline.state.split)
  const indexed = resultOf(pipeline.state.index)

  return useMemo(() => {
    const partition: Partition = indexed?.partition ?? pipeline.settings.partition
    const fromSplit = split
      ? {
          train: split.train_conversation_ids,
          validation: split.validation_conversation_ids,
          test: split.test_conversation_ids,
        }[partition]
      : []
    const fromBackend = workspace.conversationsIn(partition)
    const ids = fromSplit.length > 0 ? fromSplit : fromBackend
    return {
      partition,
      conversationIds: ids,
      preparedId: resultOf(pipeline.state.prepare)?.prepared_id ?? workspace.preparedId,
      source:
        fromSplit.length > 0
          ? ('pipeline' as const)
          : ids.length > 0
            ? ('backend' as const)
            : ('none' as const),
    }
  }, [indexed, pipeline.settings.partition, pipeline.state.prepare, split, workspace])
}

/**
 * Everything the search page works with: the form, the three runs it can
 * start, and what came back.
 *
 * Owned by the shell rather than the page, so leaving the tab does not throw
 * a search away. `reset` is the only thing that clears it.
 */
export function useRetrieval(source: ShellData) {
  const [settings, setSettings] = useState<RetrievalSettings>(DEFAULTS)
  const known = useKnownConversations(source)
  // Which checkpoint answers. Shared with the training page, so the rewrites
  // you look at here and the ones a build keeps come from the same weights.
  const { modelId, revision } = source.model
  const rewrite = useAsyncRun<RewriteResponse>()
  const search = useAsyncRun<SearchResponse>()
  const answer = useAsyncRun<AnswerResponse>()
  const [questions, setQuestions] = useState<DatasetQuestion[]>([])
  const [focus, setFocus] = useState(0)
  const [focusBudget, setFocusBudget] = useState<number | null>(null)
  const settingsRef = useRef(settings)

  const update = useCallback(
    <K extends keyof RetrievalSettings>(key: K, value: RetrievalSettings[K]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value }
        settingsRef.current = next
        return next
      })
    },
    [],
  )

  // Default the conversation to the first one this session indexed.
  useEffect(() => {
    if (settings.conversationId === '' && known.conversationIds.length > 0) {
      update('conversationId', known.conversationIds[0])
    }
  }, [known.conversationIds, settings.conversationId, update])

  // Questions for the selected conversation, so recall can be scored against
  // the dataset's own evidence rather than hand-typed turn ids. Resolving the
  // empty case through the same promise keeps every write in a callback, so a
  // stale response cannot land after the selection has moved on.
  useEffect(() => {
    const preparedId = known.preparedId
    const conversationId = settings.conversationId
    const partition = known.partition
    let cancelled = false
    const load = async (): Promise<DatasetQuestion[]> => {
      if (!preparedId || !conversationId) return []
      try {
        const next = await listQuestions(preparedId, {
          partition,
          conversationId,
          limit: 100,
        })
        return next.questions
      } catch {
        return []
      }
    }
    void load().then((next) => {
      if (!cancelled) setQuestions(next)
    })
    return () => {
      cancelled = true
    }
  }, [known.partition, known.preparedId, settings.conversationId])

  const pickQuestion = useCallback(
    (question: DatasetQuestion) => {
      setSettings((current) => {
        const next = {
          ...current,
          text: question.question,
          expectedTurnIds: question.evidence_turn_ids.join(', '),
        }
        settingsRef.current = next
        return next
      })
      answer.reset()
      search.reset()
      rewrite.reset()
    },
    [answer, rewrite, search],
  )

  const runSearch = useCallback(
    async (queries: string[]) => {
      const current = settingsRef.current
      setFocus(0)
      setFocusBudget(null)
      answer.reset()
      return search.run(() =>
        searchMemories({
          conversationId: current.conversationId.trim(),
          queries,
          topK: current.topK,
          tokenBudgets: [...current.budgets].sort((a, b) => a - b),
          expectedTurnIds: parseTurnIds(current.expectedTurnIds),
          modelId,
          revision,
        }),
      )
    },
    [answer, modelId, revision, search],
  )

  /** Ladder step 0: the message as written. */
  const runRaw = useCallback(async () => {
    const current = settingsRef.current
    rewrite.reset()
    return runSearch([current.text.trim()])
  }, [rewrite, runSearch])

  /** Ladder step 1: the prompted rewriter's candidates, beside the raw message. */
  const runRewritten = useCallback(async () => {
    const current = settingsRef.current
    const candidates = await rewrite.run(() =>
      rewriteQuery({
        text: current.text.trim(),
        inputId: `${current.conversationId.trim()}:probe`,
        seed: current.seed,
        count: current.candidates,
        temperature: current.temperature,
        maxNewTokens: current.rewriteMaxTokens,
        modelId,
        revision,
      }),
    )
    if (!candidates) return null
    const raw = current.text.trim()
    // The raw message leads, so every table reads as "as written, then rewrites".
    const queries = [raw, ...candidates.queries.filter((query) => query !== raw)]
    return runSearch(queries.slice(0, MAX_QUERIES))
  }, [modelId, revision, rewrite, runSearch])

  const runAnswer = useCallback(
    (context: string) => {
      const current = settingsRef.current
      return answer.run(() =>
        answerQuestion({
          question: current.text.trim(),
          context,
          maxNewTokens: current.answerMaxTokens,
          modelId,
          revision,
        }),
      )
    },
    [answer, modelId, revision],
  )

  const reset = useCallback(() => {
    setSettings(DEFAULTS)
    settingsRef.current = DEFAULTS
    rewrite.reset()
    search.reset()
    answer.reset()
    setFocus(0)
    setFocusBudget(null)
  }, [answer, rewrite, search])

  const result = resultOf(search.state)
  const focused = result?.results[Math.min(focus, result.results.length - 1)] ?? null
  const budget =
    focused?.budgets.find((entry) => entry.token_budget === focusBudget) ??
    focused?.budgets.at(-1) ??
    null

  const busy =
    rewrite.state.status === 'running' ||
    search.state.status === 'running' ||
    answer.state.status === 'running'

  return {
    settings,
    update,
    known,
    questions,
    pickQuestion,
    rewrite: rewrite.state,
    search: search.state,
    answer: answer.state,
    result,
    focus,
    setFocus,
    focused,
    focusBudget: budget?.token_budget ?? null,
    setFocusBudget,
    budget,
    runRaw,
    runRewritten,
    runAnswer,
    reset,
    busy,
  }
}

export type Retrieval = ReturnType<typeof useRetrieval>
