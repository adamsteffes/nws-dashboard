export type QuantitativeValue = { unitCode?: string; value?: number | null };

export type Target = "degF" | "mph" | "inHg" | "mi" | "percent" | "deg";

const warned = new Set<string>();

/** Clears the warn-once memory; for tests only. */
export function _resetUnitWarnings(): void {
  warned.clear();
}

export function qv(obj: unknown): { value: number; unitCode: string } | null {
  if (typeof obj !== "object" || obj === null) return null;
  const { value, unitCode } = obj as QuantitativeValue;
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return { value, unitCode: typeof unitCode === "string" ? unitCode : "" };
}

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const kmhToMph = (kmh: number): number => kmh / 1.609344;
export const msToMph = (ms: number): number => (ms * 3600) / 1609.344;
export const paToInHg = (pa: number): number => pa / 3386.389;
export const mToMi = (m: number): number => m / 1609.344;

const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

export function degToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.floor((normalized + 11.25) / 22.5) % 16;
  return COMPASS[index] as string;
}

export function round(n: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

const CONVERTERS: Record<Target, Record<string, (v: number) => number>> = {
  degF: { degC: cToF, degF: (v) => v },
  mph: { "km_h-1": kmhToMph, "m_s-1": msToMph },
  inHg: { Pa: paToInHg },
  mi: { m: mToMi },
  percent: { percent: (v) => v },
  deg: { "degree_(angle)": (v) => v },
};

export function convert(q: unknown, target: Target): number | null {
  const read = qv(q);
  if (!read) return null;
  const unit = read.unitCode.replace(/^wmoUnit:/, "");
  const fn = CONVERTERS[target][unit];
  if (!fn) {
    if (!warned.has(read.unitCode)) {
      warned.add(read.unitCode);
      console.warn(
        `Unsupported unit "${read.unitCode}" for target "${target}"`,
      );
    }
    return null;
  }
  return fn(read.value);
}
