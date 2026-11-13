// Inputs that commit on Enter / blur, so each edit is one undo step.
import { useEffect, useState } from 'react'

export function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input value={v} onChange={e => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value) }} />
  )
}

export function NumberField({ value, onCommit, digits = 3, step }: { value: number; onCommit: (v: number) => void; digits?: number; step?: number }) {
  const fmt = (n: number) => (Number.isFinite(n) ? +n.toFixed(digits) : 0).toString()
  const [v, setV] = useState(fmt(value))
  useEffect(() => setV(fmt(value)), [value])
  const commit = () => {
    const n = parseFloat(v.replace(',', '.'))
    if (Number.isFinite(n) && fmt(n) !== fmt(value)) onCommit(n)
    else setV(fmt(value))
  }
  return (
    <input inputMode="decimal" value={v} step={step} onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(fmt(value)) }} />
  )
}
