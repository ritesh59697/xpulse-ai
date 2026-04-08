// src/lib/agent-store.ts
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight JSON-file store for agent status and transactions.
// Used by: xpulse-agent.ts (write) and API routes (read).
// Works on Vercel (writes to /tmp which is writable) and locally.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs   from "fs";
import * as path from "path";

// On Vercel, only /tmp is writable. Locally we use ./data/
const DATA_DIR   = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA_DIR, "agent-status.json");
const TX_FILE     = path.join(DATA_DIR, "agent-transactions.json");

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(filePath: string, data: unknown) {
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

export function readAgentStatus(): AgentStatus {
  return readJSON<AgentStatus>(STATUS_FILE, DEFAULT_STATUS);
}

export function writeAgentStatus(status: Partial<AgentStatus>) {
  const current = readAgentStatus();
  writeJSON(STATUS_FILE, { ...current, ...status });
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export function readTransactions(): StoredTransaction[] {
  return readJSON<StoredTransaction[]>(TX_FILE, []);
}

export function appendTransaction(tx: StoredTransaction) {
  const existing = readTransactions();
  // Prevent duplicates by hash
  if (existing.some(t => t.hash === tx.hash)) return;
  // Newest first, cap at 10
  const updated = [tx, ...existing].slice(0, 10);
  writeJSON(TX_FILE, updated);
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
