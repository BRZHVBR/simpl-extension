// src/chains/solana/solana.tokens.ts
//
// SPL token loading. Reads the owner's parsed token accounts and returns a
// unified balance list compatible with the wallet's Home/Assets surfaces. Token
// metadata for a handful of popular mints is seeded below for nice labels/logos;
// it is NOT the source of truth — any other mint still shows up, falling back to
// a shortened mint as its symbol/name so the list never blanks or crashes.

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { SolanaChainConfig } from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import { formatTokenAmount } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { withSolanaRead } from "./solana.rpc";
import type { SolanaTokenBalance } from "./solana.types";

type KnownToken = {
  symbol: string;
  name: string;
  logoUrl: string | null;
};

// Seed metadata for popular mainnet SPL mints. Display-only; extend freely.
export const KNOWN_SPL_TOKENS: Record<string, KnownToken> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
    logoUrl: null,
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
    logoUrl: null,
  },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
    symbol: "JUP",
    name: "Jupiter",
    logoUrl: null,
  },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: "BONK",
    name: "Bonk",
    logoUrl: null,
  },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: {
    symbol: "WIF",
    name: "dogwifhat",
    logoUrl: null,
  },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: {
    symbol: "PYTH",
    name: "Pyth Network",
    logoUrl: null,
  },
};

function shortenMint(mint: string): string {
  return mint.length <= 8 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Map a mint to its display metadata, falling back to a shortened mint when the
// mint is unknown (never throws, never returns empty labels).
export function resolveTokenMetadata(mint: string): {
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
} {
  const known = KNOWN_SPL_TOKENS[mint];

  if (known) {
    return { ...known, isVerified: true };
  }

  const short = shortenMint(mint);
  return { symbol: short, name: short, logoUrl: null, isVerified: false };
}

// Metaplex Token Metadata program — the on-chain home of name/symbol/uri for
// most SPL tokens. We derive the metadata PDA and parse the account ourselves
// (a tiny borsh string reader) to avoid pulling in the heavy Metaplex SDK.
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// PDA seeds: ["metadata", metadataProgramId, mint]. Uint8Array seeds avoid any
// dependency on a Buffer polyfill.
function deriveMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("metadata"),
      METAPLEX_METADATA_PROGRAM_ID.toBytes(),
      mint.toBytes(),
    ],
    METAPLEX_METADATA_PROGRAM_ID,
  );
  return pda;
}

type MetaplexOnChain = { name: string; symbol: string; uri: string };

// Parse a Metaplex Metadata account. Layout (prefix): key(1) + updateAuthority(32)
// + mint(32), then the Data struct's first three borsh strings: name, symbol,
// uri — each a u32 little-endian length followed by UTF-8 bytes, padded with
// null bytes which we strip. Returns null on any malformed/out-of-range read.
function parseMetaplexMetadata(data: Uint8Array): MetaplexOnChain | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 1 + 32 + 32;

    const readString = (): string => {
      if (offset + 4 > data.length) throw new Error("oob");
      const len = view.getUint32(offset, true);
      offset += 4;
      // Guard against corrupt/huge lengths (max on-chain uri is 200 bytes).
      if (len > 4096 || offset + len > data.length) throw new Error("oob");
      const bytes = data.subarray(offset, offset + len);
      offset += len;
      return new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
    };

    const name = readString();
    const symbol = readString();
    const uri = readString();
    return { name, symbol, uri };
  } catch {
    return null;
  }
}

// Read + parse the Metaplex metadata account for a mint. Returns null when there
// is no metadata account (many tokens) or the account can't be parsed.
async function loadMetaplexOnChainMetadata(
  config: SolanaChainConfig,
  mint: PublicKey,
): Promise<MetaplexOnChain | null> {
  const pda = deriveMetadataPda(mint);
  const account = await withSolanaRead(config, (connection) =>
    connection.getAccountInfo(pda),
  );
  if (!account || !account.data) return null;
  const bytes =
    account.data instanceof Uint8Array
      ? account.data
      : new Uint8Array(account.data as ArrayBufferLike);
  return parseMetaplexMetadata(bytes);
}

// IPFS gateways tried in order. The first that returns valid JSON / a loadable
// image wins — important because any single gateway (e.g. nft.storage) can be
// deprecated, rate-limited or down.
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

const UNSAFE_URI_SCHEMES = /^(javascript|data|file|blob):/iu;

// Extract the "<cid>/<path>" portion from any IPFS-style URL: ipfs:// , a
// path-style gateway (…/ipfs/<cid>/…), or a subdomain-style gateway
// (https://<cid>.ipfs.<host>/…). Returns null for non-IPFS URLs.
function extractIpfsPath(url: string): string | null {
  const u = url.trim();
  if (u.startsWith("ipfs://")) {
    return u.slice("ipfs://".length).replace(/^ipfs\//u, "");
  }
  const pathStyle = u.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/iu);
  if (pathStyle) return pathStyle[1];
  const subdomainStyle = u.match(
    /^https?:\/\/([a-z0-9]+)\.ipfs\.[^/]+(\/.*)?$/iu,
  );
  if (subdomainStyle) return `${subdomainStyle[1]}${subdomainStyle[2] ?? ""}`;
  return null;
}

// Gateway candidate URLs for an IPFS "<cid>/<path>".
function getIpfsGatewayCandidates(ipfsPath: string): string[] {
  const clean = ipfsPath.replace(/^\/+/u, "");
  return IPFS_GATEWAYS.map((gateway) => gateway + clean);
}

// Turn a metadata/image URI into an ordered list of safe https candidate URLs:
//   ipfs:// or any IPFS gateway URL → every gateway candidate
//   ar://                           → arweave.net
//   https:// / http://              → as-is (still expanded if it's IPFS)
//   javascript:/data:/file:/blob:   → [] (rejected)
function normalizeMetadataUri(uri: string): string[] {
  const u = uri.trim();
  if (!u || UNSAFE_URI_SCHEMES.test(u)) return [];

  const ipfsPath = extractIpfsPath(u);
  if (ipfsPath) return getIpfsGatewayCandidates(ipfsPath);

  if (u.startsWith("ar://")) {
    return [`https://arweave.net/${u.slice("ar://".length)}`];
  }
  if (u.startsWith("https://") || u.startsWith("http://")) return [u];
  return [];
}

type OffChainMetadata = {
  name?: unknown;
  symbol?: unknown;
  image?: unknown;
  image_url?: unknown;
  logoURI?: unknown;
  logo?: unknown;
};

// Fetch the first candidate URL that returns parseable JSON, within a per-try
// timeout. JSON only — no scripts execute; only string fields are read later.
// Returns the JSON plus the URL it came from (to resolve relative image paths).
async function fetchJsonWithTimeout(
  urls: string[],
  timeoutMs = 6000,
): Promise<{ json: OffChainMetadata; baseUrl: string } | null> {
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const json = (await response.json()) as unknown;
      if (json && typeof json === "object") {
        return { json: json as OffChainMetadata, baseUrl: url };
      }
    } catch {
      // Try the next gateway candidate.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

// Build ordered, safe candidate URLs for a token image. Handles ipfs/ar/https
// (with gateway fallbacks) and relative paths resolved against the JSON's URL.
function resolveTokenImageUrl(rawImage: string, baseJsonUrl: string): string[] {
  const image = rawImage.trim();
  if (!image || UNSAFE_URI_SCHEMES.test(image)) return [];

  // Absolute / scheme'd URIs (incl. ipfs:// , ar://) go through the normalizer.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(image)) {
    return normalizeMetadataUri(image);
  }

  // Relative path — resolve against the JSON URL (a safe https base).
  try {
    return [new URL(image, baseJsonUrl).toString()];
  } catch {
    return [];
  }
}

const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

// Return the first candidate URL that actually serves an image. Tries HEAD then
// GET (some gateways reject HEAD). Accepts 200 with an image content-type, or
// 200 with a missing content-type. Moves to the next gateway on any failure.
async function validateImageUrl(
  urls: string[],
  timeoutMs = 5000,
): Promise<string | null> {
  for (const url of urls) {
    for (const method of ["HEAD", "GET"] as const) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { method, signal: controller.signal });
        if (!response.ok) continue;
        const contentType = (response.headers.get("content-type") ?? "")
          .toLowerCase()
          .split(";")[0]
          .trim();
        if (!contentType || IMAGE_CONTENT_TYPES.has(contentType)) {
          return url;
        }
        // 200 but a non-image type → not an image; skip to the next candidate.
        break;
      } catch {
        // HEAD may be unsupported — fall through to GET, then next candidate.
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return null;
}

type ResolvedSplMetadata = {
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
};

// Resolve display metadata for a mint, in priority order:
//   1. Local known list (resolveTokenMetadata) — verified tokens win outright.
//   2. Metaplex on-chain name/symbol/uri.
//   3. Off-chain JSON (name/symbol fallback + image/logo, multi-gateway).
//   4. Safe fallback: shortened mint + "Solana Token" + no logo.
// The logo URL is validated (it must actually serve an image) before being
// returned, so callers can save/use it directly. Never throws — any metadata
// failure degrades to the next source / fallback.
async function resolveSplTokenMetadata(
  config: SolanaChainConfig,
  mintKey: PublicKey,
  mint: string,
): Promise<ResolvedSplMetadata> {
  const known = resolveTokenMetadata(mint);
  if (known.isVerified) {
    return {
      symbol: known.symbol,
      name: known.name,
      logoUrl: known.logoUrl,
      isVerified: true,
    };
  }

  // Start from the safe fallback; upgrade fields as real metadata is found.
  let symbol = shortenMint(mint);
  let name = "Solana Token";
  let logoUrl: string | null = null;

  try {
    const onChain = await loadMetaplexOnChainMetadata(config, mintKey);
    if (onChain) {
      if (onChain.name) name = onChain.name;
      if (onChain.symbol) symbol = onChain.symbol;

      if (onChain.uri) {
        // The on-chain uri may itself be a dead IPFS gateway — expand it to all
        // gateway candidates and use the first that returns JSON.
        const fetched = await fetchJsonWithTimeout(
          normalizeMetadataUri(onChain.uri),
        );
        if (fetched) {
          const { json, baseUrl } = fetched;

          // Off-chain JSON fills name/symbol only when on-chain didn't provide
          // them.
          if (!onChain.name) {
            const offName = asNonEmptyString(json.name);
            if (offName) name = offName;
          }
          if (!onChain.symbol) {
            const offSymbol = asNonEmptyString(json.symbol);
            if (offSymbol) symbol = offSymbol;
          }

          // Image: accept the common field names, expand to gateway candidates,
          // and keep only a URL that actually serves an image.
          const rawImage =
            asNonEmptyString(json.image) ??
            asNonEmptyString(json.image_url) ??
            asNonEmptyString(json.logoURI) ??
            asNonEmptyString(json.logo);
          if (rawImage) {
            logoUrl = await validateImageUrl(
              resolveTokenImageUrl(rawImage, baseUrl),
            );
          }
        }
      }
    }
  } catch (error) {
    // Metadata is best-effort — never block the preview on it.
    console.debug("Solana metadata resolution failed (using fallback):", error);
  }

  return { symbol, name, logoUrl, isVerified: false };
}

export type SplTokenPreview = {
  mint: string;
  decimals: number;
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
  // Owner's balance for this mint. 0 when the owner has no associated token
  // account (never throws / crashes for a missing account).
  rawAmount: bigint;
  formatted: string;
  // On-chain total supply (base units) when the RPC returns it, else null.
  supply: string | null;
};

// Load a preview for a single SPL mint: on-chain decimals (proves it's a real
// mint), display metadata (known mints get nice labels, unknown mints fall back
// to a shortened mint + "Solana Token"), and the owner's balance for this mint
// (0 when there's no token account). Reads go through withSolanaRead, so an RPC
// failure throws a normalized Solana error — never an EVM error. The mint string
// is used verbatim (base58 is case-sensitive and must not be lowercased).
export async function loadSplTokenPreview(
  config: SolanaChainConfig,
  ownerAddress: string | null,
  mint: string,
): Promise<SplTokenPreview> {
  const trimmedMint = mint.trim();

  if (!isValidSolanaAddress(trimmedMint)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const mintKey = new PublicKey(trimmedMint);

  // 1. Read the mint account → decimals (+ supply). Confirms a real SPL mint.
  const mintInfo = await withSolanaRead(config, (connection) =>
    connection.getParsedAccountInfo(mintKey),
  );

  const data = mintInfo.value?.data;
  const parsed =
    data && typeof data === "object" && "parsed" in data
      ? (
          data as {
            parsed?: {
              type?: string;
              info?: { decimals?: number; supply?: string };
            };
          }
        ).parsed
      : null;

  if (
    !parsed ||
    parsed.type !== "mint" ||
    typeof parsed.info?.decimals !== "number"
  ) {
    throw new Error(
      `No SPL token mint at this address on ${config.name}. Check the mint address and the selected network.`,
    );
  }

  const decimals = parsed.info.decimals;
  const supply =
    typeof parsed.info.supply === "string" ? parsed.info.supply : null;

  // 2. Display metadata: local known list → Metaplex on-chain → off-chain JSON
    //    → safe fallback. Best-effort; never blocks the preview.
  const metadata = await resolveSplTokenMetadata(config, mintKey, trimmedMint);
  const symbol = metadata.symbol;
  const name = metadata.name;

  // 3. Owner balance for this mint. Missing owner / token account → 0, no crash.
  let rawAmount = 0n;
  if (ownerAddress && isValidSolanaAddress(ownerAddress)) {
    try {
      const owner = new PublicKey(ownerAddress);
      const accounts = await withSolanaRead(config, (connection) =>
        connection.getParsedTokenAccountsByOwner(owner, { mint: mintKey }),
      );
      for (const entry of accounts.value) {
        const amount = readParsedInfo(entry)?.tokenAmount?.amount;
        if (amount != null) rawAmount += BigInt(amount);
      }
    } catch (error) {
      // A balance read failure must not block the preview — default to 0.
      console.debug("Solana SPL balance read failed (defaulting to 0):", error);
    }
  }

  return {
    mint: trimmedMint,
    decimals,
    symbol,
    name,
    logoUrl: metadata.logoUrl,
    isVerified: metadata.isVerified,
    rawAmount,
    formatted: formatTokenAmount(rawAmount, decimals),
    supply,
  };
}

type ParsedTokenAccountInfo = {
  mint?: string;
  tokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
  };
};

function readParsedInfo(account: unknown): ParsedTokenAccountInfo | null {
  const parsed = (
    account as {
      account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } };
    }
  )?.account?.data?.parsed?.info;

  return parsed ?? null;
}

// Load the owner's SPL token balances. By default only positive balances are
// returned (the common wallet view); pass includeZero to keep empty accounts.
// Reads across the config's endpoints with fallback (solana.rpc).
export async function getSplTokenBalances(
  address: string,
  config: SolanaChainConfig,
  options: { includeZero?: boolean } = {},
): Promise<SolanaTokenBalance[]> {
  if (!isValidSolanaAddress(address)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const owner = new PublicKey(address);

  const response = await withSolanaRead(config, (connection) =>
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
  );

  const balances: SolanaTokenBalance[] = [];

  for (const entry of response.value) {
    const info = readParsedInfo(entry);
    const mint = info?.mint;
    const amountRaw = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;

    if (!mint || amountRaw == null || decimals == null) {
      continue;
    }

    const rawAmount = BigInt(amountRaw);

    if (!options.includeZero && rawAmount <= 0n) {
      continue;
    }

    const metadata = resolveTokenMetadata(mint);

    balances.push({
      mint,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals,
      rawAmount,
      formatted: formatTokenAmount(rawAmount, decimals),
      logoUrl: metadata.logoUrl,
      isVerified: metadata.isVerified,
    });
  }

  return balances;
}
