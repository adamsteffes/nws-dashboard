const PLAIN_DECIMAL = /^(\d+\.?\d*|\.\d+)$/;

/**
 * Parses a typed coordinate. Accepts plain decimals with an optional sign
 * (including the typographic minus U+2212 that iPadOS can insert), a decimal
 * comma, a degree sign, and a leading or trailing hemisphere letter
 * (S and W make the value negative). Hex, exponent and other forms give NaN,
 * as does a blank field or a letter that doesn't belong to the axis.
 */
export function parseCoord(text: string, axis: "lat" | "lon"): number {
  let body = text.trim().replace(/[−–]/g, "-").replace(/°/g, "");
  let letter: string | undefined;
  const leading = /^([a-z])\s*(.*)$/i.exec(body);
  if (leading) {
    letter = leading[1];
    body = leading[2] ?? "";
  }
  const trailing = /^(.*?)\s*([a-z])$/i.exec(body);
  if (trailing) {
    if (letter !== undefined) return Number.NaN;
    body = trailing[1] ?? "";
    letter = trailing[2];
  }
  body = body.trim().replace(",", ".");

  let sign = 1;
  if (letter !== undefined) {
    const hemisphere = letter.toUpperCase();
    const allowed = axis === "lat" ? "NS" : "EW";
    if (!allowed.includes(hemisphere)) return Number.NaN;
    if (hemisphere === "S" || hemisphere === "W") sign = -1;
    // "-97 W" is contradictory, so it is rejected rather than guessed at.
  } else if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }
  if (!PLAIN_DECIMAL.test(body)) return Number.NaN;
  return sign * Number(body);
}
