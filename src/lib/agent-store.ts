// src/lib/agent-store.ts
// ─────────────────────────────────────────────────────────────────────────────
// Storage layer for agent status and transactions.
// On Vercel: uses Vercel KV for persistence across function invocations.
// Locally:   uses ./data/*.json files like before.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentStatus {
  lastRun:       number;        // unix ms timestamp
  lastAction:    string;        // "BUY" | "SELL" | "HOLD"
  lastAsset:     string;        // "OKB" | "ETH" etc
  lastConfidence: number;       // 0-100
  lastInsight:   string;        // AI summary text
  walletAddress: string;        // agent wallet 0x...
  cycleCount:    number;        // total cycles run
  isRunning:     boolean;       // true while a cycle is executing
}

export interface StoredTransaction {
  hash:      string;
  type:      string;   // "WRAP" | "SWAP"
  from:      string;
  to:        string;
  amount:    string;
  status:    string;   // "confirmed" | "pending" | "failed"
  timestamp: number;   // unix ms
}

const USE_KV = !!process.env.KV_REST_API_URL;

async function kvGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const { kv } = await import("@vercel/kv");
    const value = await kv.get<T>(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const { kv } = await import("@vercel/kv");
    await kv.set(key, value);
  } catch (err) {
    console.error("[KV] write failed:", err);
  }
}

const DATA_DIR = path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA_DIR, "agent-status.json");
const TX_FILE = path.join(DATA_DIR, "agent-transactions.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fileRead<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function fileWrite(filePath: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ─── Agent Status ─────────────────────────────────────────────────────────────

const DEFAULT_STATUS: AgentStatus = {
  lastRun:        0,
  lastAction:     "HOLD",
  lastAsset:      "OKB",
  lastConfidence: 0,
  lastInsight:    "",
  walletAddress:  "",
  cycleCount:     0,
  isRunning:      false,
};

export async function readAgentStatus(): Promise<AgentStatus> {
  if (USE_KV) return kvGet<AgentStatus>("xpulse:status", DEFAULT_STATUS);
  return fileRead<AgentStatus>(STATUS_FILE, DEFAULT_STATUS);
}

export async function writeAgentStatus(status: Partial<AgentStatus>): Promise<void> {
  const current = await readAgentStatus();
  const next = { ...current, ...status };
  if (USE_KV) {
    await kvSet("xpulse:status", next);
    return;
  }
  fileWrite(STATUS_FILE, next);
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function readTransactions(): Promise<StoredTransaction[]> {
  if (USE_KV) return kvGet<StoredTransaction[]>("xpulse:transactions", []);
  return fileRead<StoredTransaction[]>(TX_FILE, []);
}

export async function appendTransaction(tx: StoredTransaction): Promise<void> {
  const existing = await readTransactions();
  // Prevent duplicates by hash
  if (existing.some(t => t.hash === tx.hash)) return;
  // Newest first, cap at 10
  const updated = [tx, ...existing].slice(0, 10);
  if (USE_KV) {
    await kvSet("xpulse:transactions", updated);
    return;
  }
  fileWrite(TX_FILE, updated);
}

// ─── Relative time helper (used by frontend too via API) ──────────────────────

export function timeAgo(timestamp: number): string {
  if (!timestamp) return "never";
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
