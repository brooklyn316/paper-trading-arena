export default function StatTile({
  label,
  value,
  title,
  delta,
  deltaGood,
}: {
  label: string;
  value: string;
  title?: string;
  delta?: string;
  deltaGood?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--chart-border)] bg-[var(--chart-surface)] p-4">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-2xl font-semibold text-[var(--text-primary)]" title={title}>
        {value}
      </div>
      {delta && (
        <div
          className="mt-1 text-xs font-medium"
          style={{ color: deltaGood ? "var(--status-good)" : "var(--status-critical)" }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
