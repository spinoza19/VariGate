export const STATUS = {
  LISTED: 0,
  FUNDED: 1,
  SHIPPED: 2,
  DELIVERED: 3,
  JUDGED: 4,
  SETTLED: 5,
  CANCELLED: 6,
} as const;

export const STATUS_LABEL: Record<number, string> = {
  0: "LISTED",
  1: "FUNDED",
  2: "IN TRANSIT",
  3: "DELIVERED",
  4: "JUDGED",
  5: "SETTLED",
  6: "WITHDRAWN",
};

export const TIER_LABEL: Record<number, string> = {
  0: "pending",
  1: "FULL REFUND",
  2: "PARTIAL 25",
  3: "PARTIAL 50",
  4: "PARTIAL 75",
  5: "FULL RELEASE",
};

export const TIER_TONE: Record<number, "green" | "amber" | "red" | "neutral"> = {
  0: "neutral",
  1: "red",
  2: "red",
  3: "amber",
  4: "green",
  5: "green",
};

export interface Observations {
  listing_token_read: string;
  arrival_token_read: string;
  cultivar_match: boolean;
  cultivar_note: string;
  leaves_before: number;
  leaves_after: number;
  variegation_before: string;
  variegation_after: string;
  claim_supported: boolean;
  claim_note: string;
  damage_level: string;
  damage_cause: string;
  rot_present: boolean;
  confidence: number;
  notes: string;
}

export interface Verdict {
  tier: number;
  seller_pct: number;
  score: number;
  days_in_transit?: number;
  observations?: Observations;
  breakdown: string[];
  judged_at?: string;
  auto?: string;
}

export interface Escrow {
  id: number;
  seller: string;
  buyer: string;
  amount: string;
  species: string;
  claim: string;
  status: number;
  tier: number;
  seller_pct: number | null;
  created_at: number;
  funded_at: number;
  shipped_at: number;
  delivered_at: number;
  delivery_source: string;
  arrival_deadline: number;
  seconds_left: number;
  /** True while nobody has established delivery, so no clock is running yet. */
  awaiting_delivery: boolean;
  listing_token: string;
  arrival_token: string;
  delivery_verified: boolean;
  tracking_url: string;
  tracking_number: string;
  /** True when the recorded URL is on the contract's carrier allowlist. */
  trackable: boolean;
  verdict: string;
  has_before: boolean;
  has_after: boolean;
}

export interface Config {
  treasury: string;
  fee_bps: number;
  /** Always "fail_closed": a validator that cannot inspect the plates votes no. */
  image_check: string;
  arrival_window_seconds: number;
  max_transit_seconds: number;
  carrier_domains: string[];
  ship_window_seconds: number;
  max_image_bytes: number;
}

export function parseVerdict(escrow: Escrow): Verdict | null {
  if (!escrow.verdict) return null;
  try {
    return JSON.parse(escrow.verdict) as Verdict;
  } catch {
    return null;
  }
}
