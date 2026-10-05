// Money is bigint micro-USD (ADR-015). Conversions use string/integer math only — never floats.
const MICRO = 1_000_000n;
const MAX_USD = 1_000_000n; // sanity cap for admin input

/** "50" | "12.5" | "0.000001" → micro-USD. Throws on anything else (negative, >6 decimals, exponent, junk). */
export function usdToMicro(input: string): bigint {
  const s = input.trim().replace(",", ".");
  const m = /^(\d{1,7})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error("INVALID_AMOUNT");
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(6, "0"));
  const micro = whole * MICRO + frac;
  if (micro > MAX_USD * MICRO) throw new Error("AMOUNT_TOO_LARGE");
  return micro;
}

/** micro-USD → "12.50" style string with 2 decimals, rounding half up (display only). */
export function microToUsd(micro: bigint, decimals = 2): string {
  if (micro < 0n) return "-" + microToUsd(-micro, decimals);
  const scale = 10n ** BigInt(6 - decimals);
  const rounded = (micro + scale / 2n) / scale;
  const factor = 10n ** BigInt(decimals);
  const whole = rounded / factor;
  const frac = (rounded % factor).toString().padStart(decimals, "0");
  return decimals > 0 ? `${whole}.${frac}` : `${whole}`;
}
