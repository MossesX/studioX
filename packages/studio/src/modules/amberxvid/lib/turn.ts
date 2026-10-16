/**
 * @file AmberX Vid TURN credential minting — the server half of the
 * `ICE_CONTRACT` (P8): ephemeral credentials for the coturn relay on the
 * Hostinger VPS, per coturn's `use-auth-secret` REST scheme:
 *
 *   username   = "<unix expiry>:<module user>"
 *   credential = base64( HMAC-SHA1( secret, username ) )
 *
 * coturn recomputes the HMAC with its own copy of the secret and honours the
 * pair until the embedded expiry — no account list on the relay, nothing to
 * revoke, and a leaked pair dies by itself in minutes. The shared secret
 * lives ONLY in server env (`AMBERXVID_TURN_SECRET` here, coturn's
 * `static-auth-secret` on the VPS) — it never reaches the client bundle;
 * clients get the short-lived pair from `/api/amberxvid/turn-credentials`.
 *
 * Everything is env-driven per the contract's parity rule, read per call
 * (never latched at import) so dev/prod and tests all take effect without
 * ordering games. Server-only.
 */

import crypto from "node:crypto";
import { ICE_CONTRACT } from "./contract";
import type { IceServerConfig } from "./types";

/** Default credential lifetime — a call sets up in seconds, not hours. */
const DEFAULT_TTL_S = 600;

export interface TurnEnvConfig {
  /** null = TURN not configured (dev without coturn): STUN-only, honestly. */
  secret: string | null;
  host: string;
  port: number;
  /** 0 disables the TLS `turns:` entry. */
  tlsPort: number;
  ttlS: number;
  stunUrls: string[];
}

/** The env-driven TURN/STUN picture, defaults per `ICE_CONTRACT`. */
export function turnConfig(): TurnEnvConfig {
  const secret = process.env.AMBERXVID_TURN_SECRET?.trim() || null;
  const host = process.env.AMBERXVID_TURN_HOST?.trim() || "turn.amberxai.com";
  const port = Number(process.env.AMBERXVID_TURN_PORT ?? "") || 3478;
  const tlsRaw = process.env.AMBERXVID_TURN_TLS_PORT;
  const tlsPort = tlsRaw === undefined ? 5349 : Number(tlsRaw) || 0;
  const ttlS = Number(process.env.AMBERXVID_TURN_TTL_S ?? "") || DEFAULT_TTL_S;
  const stunEnv = process.env.AMBERXVID_STUN_URLS?.trim();
  const stunUrls = stunEnv ? stunEnv.split(",").map((s) => s.trim()).filter(Boolean) : [...ICE_CONTRACT.stun];
  return { secret, host, port, tlsPort, ttlS, stunUrls };
}

export interface MintedTurnCredentials {
  username: string;
  credential: string;
  /** unix seconds — embedded in the username, coturn's own cutoff. */
  expiry: number;
}

/** The coturn `use-auth-secret` pair for one module user. */
export function mintTurnCredentials(user: string, secret: string, ttlS: number): MintedTurnCredentials {
  const expiry = Math.floor(Date.now() / 1000) + ttlS;
  const username = `${expiry}:${user.toLowerCase()}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, expiry };
}

/**
 * The full ICE server list for one caller: STUN always; the TURN relay (udp +
 * tcp, plus `turns:` TLS when a TLS port is configured) with a freshly minted
 * pair when the secret is present.
 */
export function iceServersFor(user: string): { iceServers: IceServerConfig[]; turnConfigured: boolean; ttlS: number; expiry: number | null } {
  const cfg = turnConfig();
  const iceServers: IceServerConfig[] = [{ urls: cfg.stunUrls }];
  if (!cfg.secret) return { iceServers, turnConfigured: false, ttlS: cfg.ttlS, expiry: null };

  const minted = mintTurnCredentials(user, cfg.secret, cfg.ttlS);
  const urls = [
    `turn:${cfg.host}:${cfg.port}?transport=udp`,
    `turn:${cfg.host}:${cfg.port}?transport=tcp`,
  ];
  if (cfg.tlsPort > 0) urls.push(`turns:${cfg.host}:${cfg.tlsPort}?transport=tcp`);
  iceServers.push({ urls, username: minted.username, credential: minted.credential });
  return { iceServers, turnConfigured: true, ttlS: cfg.ttlS, expiry: minted.expiry };
}
