'use client';

interface Props {
  value: number; // 0–1
  label?: string;
  color?: string;
  showPct?: boolean;
}

export default function ProbBar({ value, label, color = 'var(--teal)', showPct = true }: Props) {
  const pct = Math.round(value * 100);

  return (
    <div className="w-full">
      {(label || showPct) && (
        <div className="mb-0.5 flex justify-between">
          {label && <span className="text-[0.7rem] uppercase tracking-wide text-text-muted">{label}</span>}
          {showPct && (
            <span className="mono text-[0.8rem] font-bold" style={{ color }}>{pct}%</span>
          )}
        </div>
      )}
      {/* Ruler/gauge track */}
      <div
        className="relative h-1.5 overflow-visible rounded-sm"
        style={{
          backgroundImage: `repeating-linear-gradient(90deg, var(--border) 0px, var(--border) 1px, transparent 1px, transparent 6px)`,
        }}
      >
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 h-full rounded-sm transition-[width] duration-400 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `4px 0 8px ${color}`,
          }}
        />
        {/* Tick marks at 25%, 50%, 75% */}
        {[25, 50, 75].map((tick) => (
          <div
            key={tick}
            className="absolute bottom-0 w-px bg-border-bright"
            style={{ left: `${tick}%`, height: '8px', bottom: 0 }}
          />
        ))}
      </div>
    </div>
  );
}
