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
