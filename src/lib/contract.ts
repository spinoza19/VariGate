import { TransactionStatus, type TransactionHash } from "genlayer-js/types";
import { CONTRACT_ADDRESS, publicClient, type Client } from "./genlayer";
import type { Config, Escrow } from "./types";

const address = CONTRACT_ADDRESS;

// ---------------------------------------------------------------- reads ----

export async function readEscrows(): Promise<Escrow[]> {
  const raw = (await publicClient().readContract({
    address,
    functionName: "get_all",
    args: [],
  })) as string;
  return JSON.parse(raw) as Escrow[];
}

export async function readEscrow(id: number): Promise<Escrow> {
  const raw = (await publicClient().readContract({
    address,
    functionName: "get_escrow",
    args: [id],
  })) as string;
  return JSON.parse(raw) as Escrow;
}

export async function readConfig(): Promise<Config> {
  const raw = (await publicClient().readContract({
    address,
    functionName: "get_config",
    args: [],
  })) as string;
  return JSON.parse(raw) as Config;
}

const imageCache = new Map<string, string>();

/** Fetch a stored photograph and hand back an object URL for an <img>. */
export async function readImage(id: number, which: "before" | "after"): Promise<string | null> {
  const key = `${id}:${which}`;
  const hit = imageCache.get(key);
  if (hit) return hit;

  const raw = (await publicClient().readContract({
    address,
    functionName: "get_image",
    args: [id, which],
  })) as unknown;

  const bytes = toBytes(raw);
  if (!bytes || bytes.length === 0) return null;

  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }));
  imageCache.set(key, url);
  return url;
}

function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) return new Uint8Array(raw as number[]);
  if (typeof raw === "string") {
    if (raw.startsWith("0x")) {
      const hex = raw.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out;
    }
    const bin = atob(raw);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

// --------------------------------------------------------------- writes ----

export interface TxProgress {
  (stage: string): void;
}

async function send(
  client: Client,
  functionName: string,
  args: unknown[],
  value: bigint,
  onProgress?: TxProgress,
): Promise<string> {
  onProgress?.("signing");
  const hash = await client.writeContract({
    address,
    functionName,
    args: args as never,
    value,
  });
  onProgress?.("submitted");

  // The transaction is already on the network at this point. A dropped socket
  // while polling is not a failed transaction, so pick the wait back up rather
  // than telling the user their escrow broke.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.waitForTransactionReceipt({
        hash: hash as TransactionHash,
        status: TransactionStatus.FINALIZED,
        interval: 3000,
        retries: 220,
      });
      break;
    } catch (e) {
      if (!isTransient(e) || attempt >= 3) throw e;
      onProgress?.("reconnecting");
      await new Promise((r) => setTimeout(r, 6000));
    }
  }

  onProgress?.("finalized");
  return hash;
}

const isTransient = (e: unknown) =>
  /Failed to fetch|NetworkError|network error|ETIMEDOUT|ECONNRESET|socket|50[234]/i.test(
    String((e as Error)?.message ?? e),
  );

export const listSpecimen = (
  client: Client,
  species: string,
  claim: string,
  amountWei: bigint,
  beforeImg: Uint8Array,
  onProgress?: TxProgress,
) => send(client, "list_specimen", [species, claim, amountWei, beforeImg], 0n, onProgress);

export const fundEscrow = (client: Client, id: number, amountWei: bigint, onProgress?: TxProgress) =>
  send(client, "fund", [id], amountWei, onProgress);

export const markShipped = (
  client: Client,
  id: number,
  trackingUrl: string,
  trackingNumber: string,
  onProgress?: TxProgress,
) => send(client, "mark_shipped", [id, trackingUrl, trackingNumber], 0n, onProgress);

export const confirmDelivery = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "confirm_delivery", [id], 0n, onProgress);

export const checkDelivery = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "check_delivery", [id], 0n, onProgress);

export const submitArrival = (
  client: Client,
  id: number,
  afterImg: Uint8Array,
  onProgress?: TxProgress,
) => send(client, "submit_arrival", [id, afterImg], 0n, onProgress);

export const settle = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "settle", [id], 0n, onProgress);

export const cancel = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "cancel", [id], 0n, onProgress);

export const claimNoShow = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "claim_no_show", [id], 0n, onProgress);

export const claimNoShip = (client: Client, id: number, onProgress?: TxProgress) =>
  send(client, "claim_no_ship", [id], 0n, onProgress);
