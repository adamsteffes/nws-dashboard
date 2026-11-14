export type TimeStyle = "time" | "dayTime" | "weekday" | "dateTime";

const OPTIONS: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: "numeric", minute: "2-digit" },
  dayTime: { weekday: "short", hour: "numeric", minute: "2-digit" },
  weekday: { weekday: "long" },
  dateTime: {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
};

export function formatLocal(
  iso: string,
  timeZone: string,
  style: TimeStyle,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-US", { ...OPTIONS[style], timeZone })
      .format(date)
      // Newer ICU versions put a narrow no-break space before AM/PM.
      .replace(/ /g, " ")
  );
}

export function ageMinutes(iso: string, now: Date): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 60_000));
}

export function formatAge(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hr = Math.floor(minutes / 60);
  const min = minutes % 60;
  return min === 0 ? `${hr} hr ago` : `${hr} hr ${min} min ago`;
}

export const deviceZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Short zone name such as "CST", or undefined for an invalid date. */
export function zoneAbbreviation(date: Date, zone: string): string | undefined {
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
}

/**
 * Like formatLocal, plus the zone name when the location's clock differs from
 * the device's (or always, with `alwaysZone`).
 */
export function formatLocalWithZone(
  iso: string,
  zone: string,
  style: TimeStyle,
  { alwaysZone = false }: { alwaysZone?: boolean } = {},
): string {
  const when = formatLocal(iso, zone, style);
  if (when === "—" || (!alwaysZone && zone === deviceZone())) return when;
  const abbreviation = zoneAbbreviation(new Date(iso), zone);
  return abbreviation ? `${when} ${abbreviation}` : when;
}
