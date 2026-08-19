export const WEI = 10n ** 18n;

export function toWei(gen: string | number): bigint {
  const n = Number(gen);
  if (!Number.isFinite(n) || n <= 0) throw new Error("enter a positive amount");
  return BigInt(Math.round(n * 1e6)) * 10n ** 12n;
}

export function fromWei(wei: bigint | string, dp = 3): string {
  const v = typeof wei === "string" ? BigInt(wei) : wei;
  return (Number(v) / 1e18).toFixed(dp).replace(/\.?0+$/, "") || "0";
}

export function short(addr: string, size = 4): string {
  if (!addr || addr.length < 12) return addr ?? "";
  return `${addr.slice(0, 2 + size)}…${addr.slice(-size)}`;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

const ZERO = "0x0000000000000000000000000000000000000000";
export const isZero = (a?: string | null) => !a || a.toLowerCase() === ZERO;

export function countdown(seconds: number): string {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function stamp(unix: number): string {
  if (!unix) return "—";
  return new Date(unix * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 16)
    .toUpperCase();
}
