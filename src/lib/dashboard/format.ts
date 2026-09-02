// Shared display formatting for the dashboard, history list, and day-detail
// pages, so the three don't drift into slightly different money/date
// formatting over time.

export function formatCurrency(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function formatSignedCurrency(v: number): string {
  const formatted = formatCurrency(Math.abs(v));
  return v >= 0 ? `+${formatted}` : `-${formatted}`;
}

// Stat-tile hero values use compact notation (auto-compact: $10.2K, not
// $10,237.33) so they never overflow a narrow tile at hero-figure size —
// full precision stays available via the `title` tooltip and in tables.
export function formatCompactCurrency(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(v);
}

export function formatCompactSignedCurrency(v: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format(v);
}

export function formatPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** Month, day, hour:minute — for tables that span multiple days. */
export function formatDateTime(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Hour:minute only — for a scan-cycle timeline already scoped to one day. */
export function formatTime(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Weekday + full date, for a "YYYY-MM-DD" market-timezone date string (not
 * an instant). Parsed at UTC noon so the date itself never shifts a day
 * backward/forward under a timezone conversion.
 */
export function formatDayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
