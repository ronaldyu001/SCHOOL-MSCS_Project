import { useModelInfo } from './useModelInfo'
import styles from './HarnessLine.module.css'

/** A quiet line naming the models in use. */
export function HarnessLine() {
  const { info } = useModelInfo()
  if (!info) return null

  return (
    <p className={styles.line}>
      {info.loaded_model_id ?? info.default_model_id} on {info.llm_device} ·{' '}
      {info.embedding_model} for search · collection {info.qdrant_collection}
    </p>
  )
}
