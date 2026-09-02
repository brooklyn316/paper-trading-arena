import { toZonedTime, fromZonedTime } from "date-fns-tz";

const MARKET_TZ = "America/New_York";

// Regular US equity session: 9:30am - 4:00pm ET, Mon-Fri.
const SESSION_OPEN = { hour: 9, minute: 30 };
const SESSION_CLOSE = { hour: 16, minute: 0 };

// No new positions opened once we're this close to the close — leaves room
// for a position to actually develop before the hard force-close.
const NEW_POSITION_CUTOFF = { hour: 15, minute: 45 };

// Force-close window: cron fires every 5 min from ~3:55pm, so treat 3:55-4:00
// as "close everything now" regardless of which exact minute the cron lands on.
const FORCE_CLOSE_START = { hour: 15, minute: 55 };

function zonedParts(date: Date) {
  const zoned = toZonedTime(date, MARKET_TZ);
  return {
    year: zoned.getUTCFullYear(),
    month: zoned.getUTCMonth(),
    date: zoned.getUTCDate(),
    day: zoned.getUTCDay(), // 0 = Sunday, 6 = Saturday
    hour: zoned.getUTCHours(),
    minute: zoned.getUTCMinutes(),
  };
}

function minutesSinceMidnight(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function isWeekday(day: number): boolean {
  return day >= 1 && day <= 5;
}

/**
 * True during the regular 9:30am-4:00pm ET session on a weekday. Does not
 * account for market holidays (New Year's, Thanksgiving, etc.) — the bot
 * will simply find no qualifying signals and no bars on those days, which
 * is a safe no-op rather than a dangerous one.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const p = zonedParts(now);
  if (!isWeekday(p.day)) return false;
  const mins = minutesSinceMidnight(p.hour, p.minute);
  return (
    mins >= minutesSinceMidnight(SESSION_OPEN.hour, SESSION_OPEN.minute) &&
    mins < minutesSinceMidnight(SESSION_CLOSE.hour, SESSION_CLOSE.minute)
  );
}

/**
 * True until 3:45pm ET — after this, the cron should keep managing any
 * open position (and will force-close at 3:55) but should not open new ones.
 */
export function canOpenNewPosition(now: Date = new Date()): boolean {
  const p = zonedParts(now);
  if (!isWeekday(p.day)) return false;
  const mins = minutesSinceMidnight(p.hour, p.minute);
  return (
    mins >= minutesSinceMidnight(SESSION_OPEN.hour, SESSION_OPEN.minute) &&
    mins < minutesSinceMidnight(NEW_POSITION_CUTOFF.hour, NEW_POSITION_CUTOFF.minute)
  );
}

/** True from 3:55pm ET through the close — the force-close route's active window. */
export function isForceCloseWindow(now: Date = new Date()): boolean {
  const p = zonedParts(now);
  if (!isWeekday(p.day)) return false;
  const mins = minutesSinceMidnight(p.hour, p.minute);
  return (
    mins >= minutesSinceMidnight(FORCE_CLOSE_START.hour, FORCE_CLOSE_START.minute) &&
    mins < minutesSinceMidnight(SESSION_CLOSE.hour, SESSION_CLOSE.minute)
  );
}

/**
 * ISO timestamp (UTC) for today's 9:30am ET session open, for use as the
 * `start` param when fetching bars for the session VWAP calculation.
 * Built from ET wall-clock parts so it's correct regardless of the server's
 * own timezone or the EST/EDT offset in effect today.
 */
export function sessionStartUtcISO(now: Date = new Date()): string {
  const p = zonedParts(now);
  // Construct the ET wall-clock moment as if it were UTC, then let
  // fromZonedTime apply the correct EST/EDT offset for that date to get the
  // real UTC instant.
  const zonedWallTime = new Date(
    Date.UTC(p.year, p.month, p.date, SESSION_OPEN.hour, SESSION_OPEN.minute, 0)
  );
  return fromZonedTime(zonedWallTime, MARKET_TZ).toISOString();
}

/** YYYY-MM-DD in the market's timezone for the given instant. */
export function marketDateString(instant: Date): string {
  const p = zonedParts(instant);
  const mm = String(p.month + 1).padStart(2, "0");
  const dd = String(p.date).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

/** Today's date as YYYY-MM-DD in the market's timezone (for daily bookkeeping keys). */
export function todayDateStringInMarketTz(now: Date = new Date()): string {
  return marketDateString(now);
}

/**
 * UTC instant bounds [start, end) for a given ET calendar date ("YYYY-MM-DD"),
 * for querying rows that fall on that trading day. Built from ET wall-clock
 * parts so the boundary is correct regardless of the server's own timezone
 * or which EST/EDT offset was in effect on that date.
 */
export function marketDayBoundsUtc(dateStr: string): { startUtcISO: string; endUtcISO: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startWall = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const endWall = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  return {
    startUtcISO: fromZonedTime(startWall, MARKET_TZ).toISOString(),
    endUtcISO: fromZonedTime(endWall, MARKET_TZ).toISOString(),
  };
}
