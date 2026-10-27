import type { ReactNode } from 'react'
import styles from './Table.module.css'

type DataTableProps = {
  caption: string
  columns: string[]
  rows: {
    key: string
    header: ReactNode
    cells: ReactNode[]
    /** Marks the held-out row, which the evaluation ladder reports on. */
    highlight?: boolean
  }[]
  footer?: { header: ReactNode; cells: ReactNode[] }
}

export function DataTable({ caption, columns, rows, footer }: DataTableProps) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Partition</th>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.highlight ? styles.highlight : undefined}>
              <th scope="row">{row.header}</th>
              {row.cells.map((cell, index) => (
                <td key={`${row.key}-${columns[index] ?? index}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              <th scope="row">{footer.header}</th>
              {footer.cells.map((cell, index) => (
                <td key={`total-${columns[index] ?? index}`}>{cell}</td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}
