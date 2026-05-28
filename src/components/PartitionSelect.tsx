interface Props {
  partitions: string[]
  value: string
  disabled?: boolean
  onChange: (partition: string) => void
}

/** The partition listbox. Selecting a partition selects the OpenRAG model. */
export function PartitionSelect({ partitions, value, disabled, onChange }: Props) {
  return (
    <label className="partition-select">
      <span className="partition-select__label">Base documentaire</span>
      <select
        value={value}
        disabled={disabled || partitions.length === 0}
        onChange={(e) => onChange(e.target.value)}
      >
        {partitions.length === 0 && <option value="">Chargement…</option>}
        {partitions.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  )
}
