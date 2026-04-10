"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CoinData {
  id: string; symbol: string; name: string;
  current_price: number; price_change_percentage_24h: number;
  market_cap: number; image: string;
}

interface MarketGlobalData {
  market_cap_usd: number | null;
  market_cap_change_percentage_24h_usd: number | null;
}

interface MarketResponse {
  coins: CoinData[];
  global?: MarketGlobalData;
}

interface Transaction {
  hash: string; type: string; from: string; to: string;
  amount: string; status: string; timestamp: number; timeAgo: string;
}

interface AgentStatus {
  lastRun: number; lastRunAgo: string;
  lastAction: string; lastAsset: string;
  lastConfidence: number; lastInsight: string;
  lastReason: string;
  walletAddress: string; cycleCount: number; isRunning: boolean;
  lastTxHash: string; lastExecution: "executed" | "skipped";
}

interface TimelineEvent {
  id: number; time: string; message: string;
  type: "info" | "decision" | "trade" | "confirm";
}

interface InsightResponse {
  insight?: string;
  error?: string;
}

interface ChartPoint {
  time: string;
  price: number;
}

interface ChartResponse {
  chart?: ChartPoint[];
  error?: string;
}

// ─── Static fallback data ─────────────────────────────────────────────────────

const FALLBACK_MARKET: CoinData[] = [
  { id: "bitcoin",   symbol: "btc",  name: "Bitcoin",   current_price: 68420, price_change_percentage_24h: 2.4,  market_cap: 1340000000000, image: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" },
  { id: "ethereum",  symbol: "eth",  name: "Ethereum",  current_price: 3512,  price_change_percentage_24h: -1.2, market_cap: 421000000000,  image: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { id: "okb",       symbol: "okb",  name: "OKB",       current_price: 52.4,  price_change_percentage_24h: 5.7,  market_cap: 3100000000,    image: "https://assets.coingecko.com/coins/images/4463/small/WeChat_Image_20220118095654.png" },
  { id: "solana",    symbol: "sol",  name: "Solana",    current_price: 178.3, price_change_percentage_24h: 3.1,  market_cap: 82000000000,   image: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
  { id: "chainlink", symbol: "link", name: "Chainlink", current_price: 14.8,  price_change_percentage_24h: -0.8, market_cap: 9100000000,    image: "" },
];

const FALLBACK_CHART: ChartPoint[] = Array.from({ length: 24 }, (_, i) => ({
  time: `${String(i).padStart(2, "0")}:00`,
  price: 67000 + Math.sin(i * 0.4) * 1200 + Math.cos(i * 0.7) * 220,
}));

const COIN_IDS: Record<string, string> = {
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  link: "chainlink",
  okb: "okb",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPLORER = "https://www.oklink.com/xlayer";

function txUrl(hash: string)     { return `${EXPLORER}/tx/${hash.replace(/\.\.\./g, "")}`; }
function walletUrl(addr: string) { return `${EXPLORER}/address/${addr}`; }
function shortHash(h: string)    { return h.length > 16 ? `${h.slice(0, 6)}...${h.slice(-4)}` : h; }
function shortAddr(a: string)    { return a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a; }
function formatUpdatedAt(timestamp: number | null) {
  if (!timestamp) return "Waiting for first update";
  return `Updated ${new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}
function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 1e12 ? 2 : 1,
  }).format(value);
}

function formatPriceLabel(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function extractSuggestedAction(insight?: string) {
  const match = (insight ?? "").match(/ACTION:\s*(BUY|SELL|HOLD|SWAP)\s+([A-Z]+)/i);
  return {
    action: match?.[1]?.toUpperCase() ?? "HOLD",
    asset: match?.[2]?.toUpperCase() ?? "OKB",
  };
}

function extractChangeFromReason(reason?: string) {
  const match = (reason ?? "").match(/24h:\s*(-?\d+(?:\.\d+)?)%/i);
  return match ? Number(match[1]) : null;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const DARK = {
  bg: "radial-gradient(ellipse at 20% 20%, #0a0e1a 0%, #050810 40%, #000308 100%)",
  card: "rgba(255,255,255,0.04)", cardBorder: "rgba(255,255,255,0.08)",
  text: "#f0f4ff", textMuted: "rgba(180,190,220,0.5)", textSub: "rgba(180,190,220,0.35)",
  accent: "#4f9eff", accentGlow: "rgba(79,158,255,0.3)", accentSoft: "rgba(79,158,255,0.08)",
  purple: "#a855f7", purpleGlow: "rgba(168,85,247,0.3)", purpleSoft: "rgba(168,85,247,0.08)",
  green: "#34d399", greenGlow: "rgba(52,211,153,0.3)", greenSoft: "rgba(52,211,153,0.08)",
  red: "#f87171", redSoft: "rgba(248,113,113,0.08)", amber: "#fbbf24",
  headerBg: "rgba(5,8,16,0.85)", tooltipBg: "rgba(10,14,26,0.95)",
  gridStroke: "rgba(255,255,255,0.04)", chartStroke: "#4f9eff",
};

const LIGHT = {
  bg: "radial-gradient(ellipse at 20% 20%, #f0f4ff 0%, #e8edf8 40%, #dde4f5 100%)",
  card: "rgba(255,255,255,0.65)", cardBorder: "rgba(100,130,200,0.15)",
  text: "#1a2340", textMuted: "rgba(26,35,64,0.72)", textSub: "rgba(26,35,64,0.58)",
  accent: "#2563eb", accentGlow: "rgba(37,99,235,0.2)", accentSoft: "rgba(37,99,235,0.08)",
  purple: "#7c3aed", purpleGlow: "rgba(124,58,237,0.2)", purpleSoft: "rgba(124,58,237,0.07)",
  green: "#059669", greenGlow: "rgba(5,150,105,0.2)", greenSoft: "rgba(5,150,105,0.07)",
  red: "#dc2626", redSoft: "rgba(220,38,38,0.07)", amber: "#d97706",
  headerBg: "rgba(240,244,255,0.85)", tooltipBg: "rgba(240,244,255,0.97)",
  gridStroke: "rgba(40,60,120,0.06)", chartStroke: "#2563eb",
};

// ─── Reusable Components ──────────────────────────────────────────────────────

function GlassCard({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
      borderRadius: 16, border: "1px solid var(--card-border)", background: "var(--card)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
      ...style,
    }}>{children}</div>
  );
}

function PulsingDot({ color }: { color: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 8, height: 8 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.4, animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite" }} />
      <span style={{ position: "relative", borderRadius: "50%", width: 8, height: 8, background: color }} />
    </span>
  );
}

function StatCard({ label, value, delta, neg, dark }: { label: string; value: string; delta: string; neg?: boolean; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  return (
    <GlassCard style={{ padding: "20px 22px" }}>
      <div style={{ fontSize: 10, color: t.textSub, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: t.text, letterSpacing: -0.5, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: neg ? t.red : t.green, fontWeight: 600 }}>{delta}</div>
    </GlassCard>
  );
}

function MarketMoverCard({ coin, dark }: { coin: CoinData; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  const up = coin.price_change_percentage_24h >= 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderRadius: 12,
      background: up ? t.greenSoft : t.redSoft,
      border: `1px solid ${up ? t.greenGlow : "rgba(248,113,113,0.2)"}`,
    }}>
      {coin.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={coin.image} alt={coin.symbol} style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
        : <div style={{ width: 32, height: 32, borderRadius: "50%", background: t.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: t.accent, flexShrink: 0 }}>{coin.symbol.slice(0, 2).toUpperCase()}</div>
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{coin.name}</div>
        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>${coin.current_price.toLocaleString()}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: up ? t.green : t.red, background: up ? t.greenSoft : t.redSoft, padding: "3px 10px", borderRadius: 8 }}>
        {up ? "▲" : "▼"} {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
      </div>
    </div>
  );
}

function TxRow({ tx, dark, isLatest, compact = false }: { tx: Transaction; dark: boolean; isLatest: boolean; compact?: boolean }) {
  const t = dark ? DARK : LIGHT;
  const statusColor = tx.status === "confirmed" ? t.green : t.amber;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: compact ? "1.4fr 76px" : "1.4fr 70px 1fr 100px 80px 80px",
      alignItems: "center", gap: 10, padding: "12px 18px",
      borderBottom: `1px solid ${t.cardBorder}`, fontSize: 12,
      background: isLatest ? (dark ? "rgba(79,158,255,0.04)" : "rgba(37,99,235,0.04)") : "transparent",
      transition: "background 0.3s",
    }}>
      {compact ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <a
              href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
              style={{ color: t.accent, fontFamily: "monospace", fontSize: 11, textDecoration: "none", borderBottom: `1px dashed ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", cursor: "pointer", position: "relative", zIndex: 1 }}
              title="View on OKLink X Layer Mainnet"
            >
              {shortHash(tx.hash)} ↗
            </a>
            <span style={{ color: t.text, fontWeight: 500, fontSize: 11 }}>{tx.from} → {tx.to}</span>
            <span style={{ color: t.textMuted, fontSize: 10 }}>{tx.amount} · {tx.timeAgo}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ color: t.purple, background: t.purpleSoft, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textAlign: "center" as const }}>{tx.type}</span>
            <span style={{ color: statusColor, background: tx.status === "confirmed" ? t.greenSoft : "rgba(251,191,36,0.08)", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textAlign: "center" as const }}>{tx.status}</span>
          </div>
        </>
      ) : (
        <>
          <a
            href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
            style={{ color: t.accent, fontFamily: "monospace", fontSize: 11, textDecoration: "none", borderBottom: `1px dashed ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", cursor: "pointer", position: "relative", zIndex: 1 }}
            title="View on OKLink X Layer Mainnet"
          >
            {shortHash(tx.hash)} ↗
          </a>
          <span style={{ color: t.purple, background: t.purpleSoft, padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textAlign: "center" as const }}>{tx.type}</span>
          <span style={{ color: t.text, fontWeight: 500 }}>{tx.from} → {tx.to}</span>
          <span style={{ color: t.textMuted }}>{tx.amount}</span>
          <span style={{ color: statusColor, background: tx.status === "confirmed" ? t.greenSoft : "rgba(251,191,36,0.08)", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 600, textAlign: "center" as const }}>{tx.status}</span>
          <span style={{ color: t.textSub, fontSize: 10 }}>{tx.timeAgo}</span>
        </>
      )}
    </div>
  );
}

function LatestTxMonitor({ tx, dark }: { tx: Transaction | null; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  if (!tx) return (
    <GlassCard style={{ padding: "20px 22px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.textSub, letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 14 }}>Last Executed Trade</div>
      <div style={{ fontSize: 13, color: t.textMuted, padding: "24px 20px", textAlign: "center" as const }}>No transactions yet</div>
    </GlassCard>
  );
  return (
    <GlassCard style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PulsingDot color={t.green} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.textSub, letterSpacing: 1.1, textTransform: "uppercase" }}>Last Executed Trade</div>
            <div style={{ fontSize: 10.5, color: t.textSub, marginTop: 3, lineHeight: 1.45 }}>Confirmed onchain action from the latest completed cycle</div>
          </div>
        </div>
        <span style={{ fontSize: 10, color: t.green, background: t.greenSoft, border: `1px solid ${t.greenGlow}`, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>CONFIRMED</span>
      </div>
      <div style={{ padding: "16px 16px", borderRadius: 12, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, boxShadow: `0 0 20px ${t.accentGlow}` }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: t.text, marginBottom: 6 }}>{tx.type} {tx.from} → {tx.to}</div>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 12 }}>amount: {tx.amount}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11.5, color: t.accent, fontFamily: "monospace", textDecoration: "none", fontWeight: 600, borderBottom: `1px solid ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", cursor: "pointer", position: "relative", zIndex: 1 }}>
            tx: {shortHash(tx.hash)} ↗
          </a>
          <span style={{ fontSize: 10.5, color: t.textSub }}>{tx.timeAgo}</span>
        </div>
      </div>
    </GlassCard>
  );
}

function AIInsightPanel({
  insight,
  loading,
  error,
  updatedAt,
  onRefresh,
  dark,
}: {
  insight: string;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  onRefresh: () => void;
  dark: boolean;
}) {
  const t = dark ? DARK : LIGHT;
  const safeInsight = insight ?? "";
  const actionMatch     = safeInsight.match(/ACTION:\s*(BUY|SELL|HOLD)/i);
  const action          = actionMatch?.[1]?.toUpperCase();
  const actionColor     = action === "BUY" ? t.green : action === "SELL" ? t.red : t.amber;
  const confidenceMatch = safeInsight.match(/confidence[:\s]+(\d+)/i);
  const confidence      = confidenceMatch ? parseInt(confidenceMatch[1]) : null;
  const statusLabel = loading ? "Refreshing" : error ? "Needs attention" : "Live";
  const statusColor = loading ? t.accent : error ? t.red : t.green;
  const visibleInsight = safeInsight || "Awaiting market data...";
  const contentBoxHeight = 142;

  return (
    <GlassCard style={{ padding: "28px 30px", position: "relative", overflow: "hidden", alignSelf: "start", minHeight: 204 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${t.accent}, ${t.purple}, transparent)` }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, boxShadow: `0 0 12px ${t.accentGlow}` }}>🧠</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>AI Suggestion</div>
            <div style={{ fontSize: 11, color: t.textSub, marginTop: 1 }}>Groq LLaMA 3.3 · okx-dex-market skill · analysis only</div>
            <div style={{ fontSize: 11, color: t.textSub, marginTop: 3 }}>{formatUpdatedAt(updatedAt)}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ padding: "6px 13px", borderRadius: 999, background: `${statusColor}12`, border: `1px solid ${statusColor}35`, fontSize: 12, fontWeight: 700, color: statusColor }}>
            {statusLabel}
          </div>
          {action && !loading && (
            <div style={{ padding: "7px 15px", borderRadius: 8, background: `${actionColor}15`, border: `1px solid ${actionColor}40`, fontSize: 13, fontWeight: 700, color: actionColor, boxShadow: `0 0 10px ${actionColor}30` }}>
              {action === "BUY" ? "📈" : action === "SELL" ? "📉" : "⏸"} {action}
            </div>
          )}
          {confidence !== null && !loading && (
            <div style={{ padding: "7px 15px", borderRadius: 8, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, fontSize: 13, fontWeight: 600, color: t.accent }}>{confidence}% confidence</div>
          )}
          <button onClick={() => onRefresh()} style={{ background: t.accentSoft, border: `1px solid ${t.accentGlow}`, color: t.accent, fontSize: 13, padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>↻ Refresh Analysis</button>
        </div>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: t.red, marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: t.redSoft, border: `1px solid ${t.red}25` }}>
          {error}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: t.textSub, marginBottom: 13 }}>
        Refreshing this panel updates the market suggestion only. Executed trades are shown separately in Last Executed Trade.
      </div>
      <div style={{ position: "relative", fontSize: 14.5, lineHeight: 1.95, color: t.text, whiteSpace: "pre-wrap", padding: "17px 18px", borderRadius: 10, background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)", border: `1px solid ${t.cardBorder}`, minHeight: contentBoxHeight }}>
        <div style={{ maxHeight: contentBoxHeight - 10, overflowY: "auto", paddingRight: 4 }}>
          {visibleInsight}
        </div>
        {loading && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 10, background: dark ? "rgba(5,8,16,0.18)" : "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 999, background: dark ? "rgba(10,14,26,0.9)" : "rgba(255,255,255,0.92)", border: `1px solid ${t.accentGlow}`, boxShadow: `0 6px 18px ${t.accentGlow}` }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span>
              Refreshing analysis...
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

function QuantRuleCard({ dark }: { dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  const rules = [
    { label: "Min confidence", value: "60% to execute" },
    { label: "BUY threshold", value: "> 5% 24h change" },
    { label: "SELL threshold", value: "< -4% 24h change" },
    { label: "Neutral band", value: "|24h| < 1% => HOLD" },
    { label: "Trade cap", value: "0.001 OKB max" },
    { label: "Gas buffer", value: "0.001 OKB minimum extra" },
  ];

  return (
    <GlassCard style={{ padding: "20px 22px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16, paddingBottom: 7, borderBottom: `2px solid ${t.accentGlow}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: t.text, letterSpacing: 0.35, fontFamily: "'Avenir Next', 'Trebuchet MS', sans-serif" }}>
          Quant Rules
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rules.map((rule) => (
          <div
            key={rule.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "1px 0",
            }}
          >
            <span style={{ fontSize: 12.5, color: t.textMuted, fontWeight: 600 }}>{rule.label}</span>
            <span style={{ fontSize: 12.5, color: t.text, fontWeight: 700, textAlign: "right" as const }}>{rule.value}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function CycleTraceCard({ status, dark }: { status: AgentStatus | null; dark: boolean }) {
  const t = dark ? DARK : LIGHT;

  if (!status || !status.lastRun) {
    return (
      <GlassCard style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.text, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
          Cycle Result
        </div>
        <div style={{ fontSize: 12, color: t.textMuted }}>Run the agent once to see the latest rule trace.</div>
      </GlassCard>
    );
  }

  const suggested = extractSuggestedAction(status.lastInsight);
  const move = extractChangeFromReason(status.lastReason);
  const confidencePass = status.lastConfidence >= 60;
  const movePass =
    move === null
      ? null
      : suggested.action === "BUY"
        ? move > 5
        : suggested.action === "SELL"
          ? move < -4
          : Math.abs(move) < 1;

  const rows = [
    {
      label: "AI suggested",
      value: `${suggested.action} ${suggested.asset}`,
      tone: t.accent,
      bg: t.accentSoft,
    },
    {
      label: "Confidence gate",
      value: `${status.lastConfidence}% ${confidencePass ? "passed" : "blocked"}`,
      tone: confidencePass ? t.green : t.red,
      bg: confidencePass ? t.greenSoft : t.redSoft,
    },
    {
      label: "Momentum rule",
      value:
        move === null
          ? "Using latest rule output"
          : `${move >= 0 ? "+" : ""}${move.toFixed(2)}% ${movePass ? "qualified" : "held back"}`,
      tone: movePass === null ? t.textMuted : movePass ? t.green : t.amber,
      bg: movePass === null ? (dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)") : movePass ? t.greenSoft : "rgba(251,191,36,0.08)",
    },
    {
      label: "Final result",
      value: status.lastExecution === "executed" ? `${status.lastAction} executed` : `${status.lastAction} skipped`,
      tone: status.lastExecution === "executed" ? t.green : t.text,
      bg: status.lastExecution === "executed" ? t.greenSoft : (dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
    },
  ];

  return (
    <GlassCard style={{ padding: "24px 26px", minHeight: 356, display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.text, letterSpacing: 1.2, textTransform: "uppercase" }}>Cycle Result</div>
          <div style={{ fontSize: 11, color: t.textSub, marginTop: 3 }}>Latest rule trace for the most recent agent cycle</div>
        </div>
        <div style={{ fontSize: 10, color: t.accent, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, padding: "4px 10px", borderRadius: 999, fontWeight: 700 }}>
          #{status.cycleCount}
        </div>
      </div>

      <div style={{ display: "grid", gap: 11 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "110px minmax(0, 1fr)",
              gap: 12,
              alignItems: "center",
              padding: "13px 14px",
              borderRadius: 12,
              background: row.bg,
              border: `1px solid ${t.cardBorder}`,
            }}
          >
            <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: 1 }}>{row.label}</div>
            <div style={{ fontSize: 13.5, color: row.tone, fontWeight: 700 }}>{row.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 15, fontSize: 12.5, color: t.textMuted, lineHeight: 1.7 }}>
        {status.lastReason || "Rule trace unavailable for this cycle."}
      </div>

      <div style={{ marginTop: 18, paddingTop: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <div style={{ padding: "12px 13px", borderRadius: 12, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 9, color: t.textSub, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Execution</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: status.lastExecution === "executed" ? t.green : t.text }}>
            {status.lastExecution === "executed" ? "Executed" : "Skipped"}
          </div>
        </div>
        <div style={{ padding: "12px 13px", borderRadius: 12, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 9, color: t.textSub, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tx State</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: status.lastTxHash ? t.accent : t.text }}>
            {status.lastTxHash ? shortHash(status.lastTxHash) : "No tx"}
          </div>
        </div>
        <div style={{ padding: "12px 13px", borderRadius: 12, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 9, color: t.textSub, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Updated</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>
            {new Date(status.lastRun).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function TimelinePanel({ events, dark }: { events: TimelineEvent[]; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  const cfg = {
    confirm:  { color: t.green,     icon: "✓", bg: t.greenSoft  },
    trade:    { color: t.purple,    icon: "⚡", bg: t.purpleSoft },
    decision: { color: t.accent,    icon: "◆", bg: t.accentSoft  },
    info:     { color: t.textMuted, icon: "·", bg: "transparent" },
  };
  return (
    <GlassCard style={{ padding: "18px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: t.textSub, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 16 }}>AI Reasoning Timeline</div>
      <div style={{ maxHeight: 190, overflowY: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexDirection: "column", gap: 2 }}>
        {events.length === 0 && <div style={{ fontSize: 12, color: t.textMuted, padding: "20px", textAlign: "center" as const }}>Waiting for agent cycle...</div>}
        {events.map((ev, i) => {
          const c = cfg[ev.type];
          return (
            <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 9px", borderRadius: 8, background: i === 0 ? c.bg : "transparent", border: `1px solid ${i === 0 ? c.color + "30" : "transparent"}`, animation: i === 0 ? "slideIn 0.3s ease" : "none" }}>
              <span style={{ fontSize: 11, color: t.textSub, fontFamily: "monospace", flexShrink: 0, marginTop: 1 }}>{ev.time}</span>
              <span style={{ width: 16, height: 16, borderRadius: "50%", background: c.bg, border: `1px solid ${c.color}50`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: c.color, flexShrink: 0 }}>{c.icon}</span>
              <span style={{ fontSize: 11, lineHeight: 1.45, color: i === 0 ? t.text : t.textMuted, flex: 1, fontWeight: i === 0 ? 500 : 400 }}>{ev.message}</span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function ChartTooltipCard({
  active,
  payload,
  label,
  dark,
  changeText,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  dark: boolean;
  changeText: string;
}) {
  const t = dark ? DARK : LIGHT;
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: t.tooltipBg,
        border: `1px solid ${t.cardBorder}`,
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: `0 12px 30px ${dark ? "rgba(0,0,0,0.28)" : "rgba(37,99,235,0.14)"}`,
        minWidth: 132,
      }}
    >
      <div style={{ fontSize: 10, color: t.textSub, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, color: t.text, fontWeight: 700 }}>{formatPriceLabel(payload[0].value)}</div>
      <div style={{ fontSize: 11, color: changeText.startsWith("-") ? t.red : t.green, marginTop: 4, fontWeight: 600 }}>{changeText} today</div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function XpulseDashboard() {
  const [dark, setDark]                     = useState(false);
  const [viewportWidth, setViewportWidth]   = useState(1440);
  const [marketData, setMarketData]         = useState<CoinData[]>(FALLBACK_MARKET);
  const [marketUpdatedAt, setMarketUpdatedAt] = useState<number | null>(null);
  const [marketGlobal, setMarketGlobal]     = useState<MarketGlobalData | null>(null);
  const [activeTab, setActiveTab]           = useState("btc");
  const [chartData, setChartData]           = useState<ChartPoint[]>(FALLBACK_CHART);
  const [chartLoading, setChartLoading]     = useState(false);
  const [chartUpdatedAt, setChartUpdatedAt] = useState<number | null>(null);
  const [insight, setInsight]               = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError]     = useState<string | null>(null);
  const [insightUpdatedAt, setInsightUpdatedAt] = useState<number | null>(null);
  const [transactions, setTransactions]     = useState<Transaction[]>([]);
  const [agentStatus, setAgentStatus]       = useState<AgentStatus | null>(null);
  const [timeline, setTimeline]             = useState<TimelineEvent[]>([]);
  const [mounted, setMounted]               = useState(false);
  const [portfolio, setPortfolio]           = useState({ okb: 0, wokb: 0, okbUsd: 0, wokbUsd: 0, totalUsd: 0 });
  const [agentRunning, setAgentRunning]     = useState(false);
  const [portfolioUpdatedAt, setPortfolioUpdatedAt] = useState<number | null>(null);
  const nextId                              = useRef(1);
  const t                                   = dark ? DARK : LIGHT;
  const prevStatusRef                       = useRef<AgentStatus | null>(null);
  const pushTimelineEvent = useCallback((type: TimelineEvent["type"], message: string, time: string) => {
    setTimeline((prev) => {
      const duplicate = prev.find((event, index) => index < 4 && event.type === type && event.message === message);
      if (duplicate) return prev;
      return [{ id: nextId.current++, time, message, type }, ...prev].slice(0, 30);
    });
  }, []);

  // ── Theme persistence ───────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("xpulse-theme");
    if (saved) {
      setDark(saved === "dark");
    } else {
      setDark(false);
    }
  }, []);
  useEffect(() => { if (mounted) localStorage.setItem("xpulse-theme", dark ? "dark" : "light"); }, [dark, mounted]);
  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // ── Fetch market data ───────────────────────────────────────────────────────
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch("/api/market", { cache: "no-store" });
      const data = await res.json() as MarketResponse | CoinData[];

      // Backward-compatible with the old array-only response shape.
      if (Array.isArray(data)) {
        setMarketData(data);
        return;
      }

      if (Array.isArray(data.coins)) {
        setMarketData(data.coins);
        setMarketUpdatedAt(Date.now());
      }

      if (data.global) {
        setMarketGlobal(data.global);
      }
    } catch {
      // Keep the existing market snapshot if refresh fails.
    }
  }, []);

  const fetchChart = useCallback(async () => {
    setChartLoading(true);
    try {
      const coin = COIN_IDS[activeTab] ?? COIN_IDS.btc;
      const res = await fetch(`/api/chart?coin=${coin}`, { cache: "no-store" });
      const data = await res.json() as ChartResponse;
      if (!res.ok) {
        throw new Error(data.error || `Chart request failed with status ${res.status}`);
      }
      if (Array.isArray(data.chart) && data.chart.length > 0) {
        setChartData(data.chart);
        setChartUpdatedAt(Date.now());
      }
    } catch {
      // Keep the previous chart if live data fails.
    } finally {
      setChartLoading(false);
    }
  }, [activeTab]);

  // ── Fetch wallet portfolio balances (server-side to avoid CORS) ───────────
  const fetchPortfolio = useCallback(async () => {
    try {
      // Call our Next.js API route — runs on server, no CORS issues
      const res  = await fetch("/api/portfolio", { cache: "no-store" });
      const data = await res.json();
      if (data.error && !data.okb) return; // keep existing values on error
      setPortfolio({
        okb:      data.okb      ?? 0,
        wokb:     data.wokb     ?? 0,
        okbUsd:   data.okbUsd   ?? 0,
        wokbUsd:  data.wokbUsd  ?? 0,
        totalUsd: data.totalUsd ?? 0,
      });
      setPortfolioUpdatedAt(Date.now());
    } catch { /* keep existing portfolio */ }
  }, []);

  // ── Fetch real transactions from store ──────────────────────────────────────
  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/transactions", { cache: "no-store" });
      const data: Transaction[] = await res.json();
      setTransactions(Array.isArray(data) ? data : []);
    } catch {
      setTransactions([]);
    }
  }, []);

  // ── Fetch real agent status ─────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json() as AgentStatus;
      if (typeof data.lastRun !== "number") return;
      setAgentStatus(data);

      // Build timeline events from status changes
      if (data.lastRun > 0) {
        const prev = prevStatusRef.current;
        const shouldResync =
          !prev ||
          prev.lastRun !== data.lastRun ||
          prev.cycleCount !== data.cycleCount ||
          timeline.length === 0;

        if (!shouldResync) {
          prevStatusRef.current = data;
          return;
        }

        const time = new Date(data.lastRun).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
        const events: TimelineEvent[] = [];

        if (data.lastTxHash) {
          events.push({
            id: nextId.current++,
            time,
            message: `Transaction submitted — ${data.lastAsset === "OKB" ? "OKB → WOKB" : `${data.lastAction} ${data.lastAsset}`}`,
            type: "confirm",
          });
        } else if (data.lastAction !== "HOLD") {
          events.push({
            id: nextId.current++,
            time,
            message: `Execution attempted — ${data.lastAction} ${data.lastAsset}`,
            type: "trade",
          });
        }

        if (data.lastAction !== "HOLD" && data.lastExecution === "executed") {
          events.push({ id: nextId.current++, time, message: `Executing via okx-agentic-wallet skill`, type: "trade" });
        }
        events.push({ id: nextId.current++, time, message: `Decision: ${data.lastAction} ${data.lastAsset} — ${data.lastConfidence}% confidence`, type: "decision" });
        events.push({ id: nextId.current++, time, message: "AI insight generated via Groq LLaMA 3.3", type: "info" });
        events.push({ id: nextId.current++, time, message: `Agent cycle #${data.cycleCount} complete`, type: "info" });

        setTimeline(prev => {
          const preserveManual = prev.filter((event) => {
            const isFreshSystemEvent = events.some((fresh) => fresh.type === event.type && fresh.message === event.message);
            return !isFreshSystemEvent;
          });
          return [...events, ...preserveManual].slice(0, 30);
        });

        if (data.lastInsight) {
          setInsight(data.lastInsight);
          setInsightError(null);
          setInsightUpdatedAt(data.lastRun);
        }

        prevStatusRef.current = data;
      }
    } catch { /* keep existing */ }
  }, [timeline.length]);

  const runAgent = useCallback(async () => {
    if (agentRunning) return;
    setAgentRunning(true);
    const now = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
    pushTimelineEvent("info", "Agent cycle triggered manually", now);
    try {
      const res = await fetch("/api/agent", { method: "POST", cache: "no-store" });
      const data = await res.json() as {
        success?: boolean;
        error?: string;
        txHash?: string | null;
        decision?: { action?: string; asset?: string };
      };

      const now2 = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      if (!res.ok || !data.success) {
        pushTimelineEvent("info", `Cycle error: ${data.error ?? "unknown error"}`, now2);
        return;
      }

      pushTimelineEvent(
        data.txHash ? "confirm" : "decision",
        data.txHash
          ? `TX confirmed: ${data.txHash.slice(0, 10)}...`
          : `Cycle complete — ${data.decision?.action ?? "HOLD"} ${data.decision?.asset ?? ""}`.trim(),
        now2
      );

      await Promise.all([fetchStatus(), fetchTransactions(), fetchPortfolio()]);
      setTimeout(() => {
        void Promise.all([fetchStatus(), fetchTransactions(), fetchPortfolio()]);
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const now2 = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      pushTimelineEvent("info", `Cycle error: ${message}`, now2);
    } finally {
      setAgentRunning(false);
    }
  }, [agentRunning, fetchPortfolio, fetchStatus, fetchTransactions, pushTimelineEvent]);

  // ── AI insight (manual refresh) ─────────────────────────────────────────────
  const fetchInsight = useCallback(async (snapshot?: CoinData[]) => {
    setInsightLoading(true);
    setInsightError(null);
    const now = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
    pushTimelineEvent("info", "Generating AI insight via Groq LLaMA 3.3", now);
    try {
      const payload = snapshot ?? marketData;
      const res  = await fetch("/api/insight", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketData: payload }) });
      const data = await res.json() as InsightResponse;
      if (!res.ok) {
        throw new Error(data.error || data.insight || `Insight request failed with status ${res.status}`);
      }
      setInsight(data.insight || "Signal unavailable.");
      setInsightUpdatedAt(Date.now());
      const action = data.insight?.match(/ACTION:\s*\w+/i)?.[0] || "HOLD";
      const now2   = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      pushTimelineEvent("decision", `Decision: ${action}`, now2);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setInsightError(message);
    }
    setInsightLoading(false);
  }, [marketData, pushTimelineEvent]);

  // ── Initial data load ───────────────────────────────────────────────────────
  useEffect(() => { fetchMarket(); }, [fetchMarket]);
  useEffect(() => { fetchChart(); }, [fetchChart]);
  useEffect(() => { fetchStatus(); fetchTransactions(); fetchPortfolio(); }, [fetchStatus, fetchTransactions, fetchPortfolio]);

  // ── Auto-refresh cadence ────────────────────────────────────────────────────
  useEffect(() => {
    const agentInterval = setInterval(() => {
      fetchStatus();
      fetchTransactions();
      fetchPortfolio();
    }, 5000);

    const marketInterval = setInterval(() => {
      fetchMarket();
      fetchChart();
    }, 60000);

    return () => {
      clearInterval(agentInterval);
      clearInterval(marketInterval);
    };
  }, [fetchChart, fetchMarket, fetchStatus, fetchTransactions, fetchPortfolio]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const topGainer    = [...marketData].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)[0];
  const topLoser     = [...marketData]
    .filter((coin) => coin.price_change_percentage_24h < 0)
    .sort((a, b) => a.price_change_percentage_24h - b.price_change_percentage_24h)[0];
  const latestTx     = transactions[0] ?? null;
  const walletAddr   = agentStatus?.walletAddress || "0x3480690b1D9337Bb6e3ea471C7a5a84861563Bfd";
  const lastTradeAgo = agentStatus?.lastRunAgo || (latestTx ? latestTx.timeAgo : "never");
  const isActive     = agentRunning || agentStatus?.isRunning || Boolean(agentStatus && agentStatus.lastRun > 0 && (Date.now() - agentStatus.lastRun) < 20 * 60 * 1000);
  const fallbackMarketCap = marketData.reduce((sum, coin) => sum + coin.market_cap, 0);
  const totalMarketCap = marketGlobal?.market_cap_usd ?? fallbackMarketCap;
  const totalMarketCapDelta = marketGlobal?.market_cap_change_percentage_24h_usd ?? 0;
  const formattedMarketCap = formatCompactUsd(totalMarketCap);
  const formattedMarketCapDelta = `${totalMarketCapDelta >= 0 ? "+" : ""}${totalMarketCapDelta.toFixed(2)}% today`;
  const isTablet = viewportWidth <= 1180;
  const isMobile = viewportWidth <= 768;
  const statsGridColumns = isMobile ? "1fr" : isTablet ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))";
  const insightGridColumns = isMobile ? "1fr" : isTablet ? "minmax(0, 1fr)" : "minmax(0, 1fr) 320px";
  const marketGridColumns = isMobile ? "1fr" : isTablet ? "minmax(0, 1fr)" : "280px minmax(0, 1fr)";
  const headerLayout = isTablet ? "column" : "row";
  const mainPadding = isMobile ? "18px 14px 28px" : isTablet ? "24px 20px 32px" : "28px 32px";
  const tableColumns = isMobile ? "1.4fr 76px" : "1.4fr 70px 1fr 100px 80px 80px";
  const headerBlur = isMobile ? "blur(14px) saturate(145%)" : "blur(24px) saturate(180%)";
  const pageTransition = isMobile ? "background 0.25s ease" : "background 0.5s ease";
  const selectedCoin = marketData.find((coin) => coin.symbol === activeTab) ?? marketData[0];
  const latestChartPoint = chartData[chartData.length - 1] ?? null;
  const chartPrices = chartData.map((point) => point.price);
  const chartHigh = chartPrices.length ? Math.max(...chartPrices) : 0;
  const chartLow = chartPrices.length ? Math.min(...chartPrices) : 0;
  const chartTrendUp = (selectedCoin?.price_change_percentage_24h ?? 0) >= 0;
  const chartStroke = chartTrendUp ? t.green : t.red;
  const chartFillTop = chartTrendUp ? "rgba(5,150,105,0.24)" : "rgba(220,38,38,0.2)";
  const chartFillBottom = chartTrendUp ? "rgba(5,150,105,0.02)" : "rgba(220,38,38,0.02)";
  const chartDeltaText = `${chartTrendUp ? "+" : ""}${(selectedCoin?.price_change_percentage_24h ?? 0).toFixed(2)}%`;
  const chartRangeText = chartHigh && chartLow ? `${formatPriceLabel(chartLow)} - ${formatPriceLabel(chartHigh)}` : "Waiting for range";

  const cssVars = { "--card": t.card, "--card-border": t.cardBorder } as React.CSSProperties;

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", transition: pageTransition, overflowX: "hidden", WebkitTapHighlightColor: "transparent", touchAction: "manipulation", ...cssVars }}>
      <style>{`
        @keyframes ping { 75%,100%{transform:scale(2);opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        * { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior: smooth; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(128,128,128,0.2); border-radius:2px; }
      `}</style>

      {/* ── Header ── */}
      <header style={{ display: "flex", flexDirection: headerLayout, alignItems: isTablet ? "stretch" : "center", justifyContent: "space-between", gap: isTablet ? 12 : 0, padding: isMobile ? "12px 14px" : isTablet ? "14px 20px" : "14px 32px", background: t.headerBg, backdropFilter: headerBlur, WebkitBackdropFilter: headerBlur, borderBottom: `1px solid ${t.cardBorder}`, position: "sticky", top: 0, zIndex: 100 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", boxShadow: `0 4px 16px ${t.accentGlow}` }}>X</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: t.text, letterSpacing: -0.3 }}>Xpulse AI</div>
            <div style={{ fontSize: 9, color: t.textSub, letterSpacing: 1.2, textTransform: "uppercase" }}>Autonomous · X Layer Mainnet · Onchain OS</div>
          </div>
        </div>

        {/* Chain badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: isTablet ? "flex-start" : "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, borderRadius: 20, padding: "5px 14px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent, display: "inline-block" }} />
            <span style={{ fontSize: 11, color: t.accent, fontWeight: 600 }}>Chain ID 196</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: t.purpleSoft, border: `1px solid ${t.purpleGlow}`, borderRadius: 20, padding: "5px 14px" }}>
            <span style={{ fontSize: 10, color: t.purple, fontWeight: 600 }}>⚙ Onchain OS</span>
          </div>
          {agentStatus && (
            <div style={{ fontSize: 10, color: t.textSub, background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", padding: "5px 12px", borderRadius: 20, border: `1px solid ${t.cardBorder}` }}>
              {agentStatus.cycleCount} cycles run
            </div>
          )}
        </div>

        {/* Right: Agent status + theme toggle */}
        <div style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", gap: 10, flexDirection: isMobile ? "column" : "row", justifyContent: isTablet ? "space-between" : "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.greenSoft, border: `1px solid ${t.greenGlow}`, borderRadius: 12, padding: "8px 16px", boxShadow: `0 0 16px ${t.greenGlow}`, width: isMobile ? "100%" : "auto" }}>
            {isActive ? <PulsingDot color={t.green} /> : <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.amber, display: "inline-block" }} />}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? t.green : t.amber, letterSpacing: 0.5 }}>{isActive ? "AGENT ACTIVE" : "AGENT IDLE"}</div>
              <div style={{ fontSize: 9, color: t.textMuted, marginTop: 1 }}>last run: {lastTradeAgo}</div>
              <div style={{ fontSize: 9, color: t.textMuted, marginTop: 1 }}>cycles completed: {agentStatus?.cycleCount ?? 0}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : "auto" }}>
            <button
              onClick={runAgent}
              disabled={agentRunning}
              style={{
                background: agentRunning ? t.accentSoft : `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                border: "none",
                borderRadius: 10,
                padding: isMobile ? "10px 16px" : "8px 16px",
                cursor: agentRunning ? "not-allowed" : "pointer",
                color: agentRunning ? t.textMuted : "#fff",
                fontSize: isMobile ? 13 : 12,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                opacity: agentRunning ? 0.7 : 1,
                transition: "all 0.2s",
                boxShadow: agentRunning ? "none" : `0 4px 14px ${t.accentGlow}`,
                flex: isMobile ? 1 : "initial",
              }}
            >
              <span style={{ fontSize: 14, animation: agentRunning ? "spin 1s linear infinite" : "none", display: "inline-block" }}>
                {agentRunning ? "◌" : "▶"}
              </span>
              {agentRunning ? "Running..." : "Run Agent"}
            </button>
            <button onClick={() => setDark(d => !d)} style={{ background: dark ? "rgba(255,255,255,0.07)" : "rgba(37,99,235,0.1)", border: `1px solid ${dark ? "rgba(255,255,255,0.12)" : "rgba(37,99,235,0.2)"}`, borderRadius: 50, padding: isMobile ? "10px 14px" : "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: dark ? "rgba(180,190,220,0.7)" : "rgba(37,99,235,0.8)", fontSize: isMobile ? 13 : 12, flex: isMobile ? 1 : "initial" }}>
              <span style={{ fontSize: 14 }}>{dark ? "☀️" : "🌙"}</span>
              <span style={{ fontWeight: 500 }}>{dark ? "Light" : "Dark"}</span>
            </button>
          </div>
        </div>
      </header>

      <main style={{ padding: mainPadding, maxWidth: 1440, margin: "0 auto" }}>

        {/* ── Stats row ── */}
        <div style={{ display: "grid", gridTemplateColumns: statsGridColumns, gap: 14, marginBottom: 20, animation: "fadeUp 0.5s ease" }}>
          <StatCard
            dark={dark}
            label="Total Market Cap"
            value={formattedMarketCap}
            delta={formattedMarketCapDelta}
            neg={totalMarketCapDelta < 0}
          />
          <StatCard
            dark={dark}
            label="Top Gainer"
            value={topGainer?.symbol.toUpperCase() ?? "—"}
            delta={`${topGainer && topGainer.price_change_percentage_24h >= 0 ? "+" : ""}${topGainer?.price_change_percentage_24h.toFixed(2) ?? "0.00"}%`}
            neg={(topGainer?.price_change_percentage_24h ?? 0) < 0}
          />
          <StatCard
            dark={dark}
            label="Top Loser"
            value={topLoser?.symbol.toUpperCase() ?? "No losers today"}
            delta={topLoser ? `${topLoser.price_change_percentage_24h.toFixed(2)}%` : "All tracked assets are green"}
            neg={Boolean(topLoser)}
          />
          {/* Agent Portfolio card */}
          <GlassCard style={{ padding: "20px 22px" }}>
            <div style={{ fontSize: 10, color: t.textSub, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10, fontWeight: 500 }}>Agent Portfolio</div>
            <div style={{ fontSize: 10, color: t.textSub, marginBottom: 10 }}>{formatUpdatedAt(portfolioUpdatedAt)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>OKB</span>
                <span style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>
                  {portfolio.okb.toFixed(4)}
                  <span style={{ fontSize: 10, color: t.textSub, marginLeft: 4 }}>(${portfolio.okbUsd.toFixed(2)})</span>
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>WOKB</span>
                <span style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>
                  {portfolio.wokb.toFixed(4)}
                  <span style={{ fontSize: 10, color: t.textSub, marginLeft: 4 }}>(${portfolio.wokbUsd.toFixed(2)})</span>
                </span>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${t.cardBorder}`, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: t.textSub }}>Total Value</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: t.green }}>${portfolio.totalUsd.toFixed(2)}</span>
            </div>
          </GlassCard>
        </div>

        {/* ── AI Insight + Latest TX ── */}
        <div style={{ display: "grid", gridTemplateColumns: insightGridColumns, alignItems: "stretch", gap: 14, marginBottom: 20, animation: "fadeUp 0.5s ease 0.1s both" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: "100%", height: "100%" }}>
            <AIInsightPanel insight={insight} loading={insightLoading} error={insightError} updatedAt={insightUpdatedAt} onRefresh={fetchInsight} dark={dark} />
            <CycleTraceCard status={agentStatus} dark={dark} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: "100%" }}>
            <TimelinePanel events={timeline} dark={dark} />
            <QuantRuleCard dark={dark} />
            <LatestTxMonitor tx={latestTx} dark={dark} />
          </div>
        </div>

        {/* ── Market + Chart + Timeline ── */}
        <div style={{ display: "grid", gridTemplateColumns: marketGridColumns, gap: 14, marginBottom: 20, animation: "fadeUp 0.5s ease 0.2s both" }}>
          <GlassCard style={{ padding: "20px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.textSub, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 }}>Market Movers</div>
            <div style={{ fontSize: 10, color: t.textSub, marginBottom: 12 }}>{formatUpdatedAt(marketUpdatedAt)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {marketData.map(c => <MarketMoverCard key={c.id} coin={c} dark={dark} />)}
            </div>
          </GlassCard>

          <GlassCard style={{ padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0, marginBottom: 18 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 3 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Price Chart</div>
                  {selectedCoin && (
                    <div style={{ padding: "4px 10px", borderRadius: 999, background: chartTrendUp ? t.greenSoft : t.redSoft, border: `1px solid ${chartTrendUp ? t.greenGlow : `${t.red}33`}`, fontSize: 11, fontWeight: 700, color: chartTrendUp ? t.green : t.red }}>
                      {selectedCoin.symbol.toUpperCase()} {chartDeltaText}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: t.textSub, marginTop: 2 }}>24H Performance · {formatUpdatedAt(chartUpdatedAt)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: t.textSub, textTransform: "uppercase", letterSpacing: 1 }}>Latest</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: -0.5 }}>{formatPriceLabel(latestChartPoint?.price ?? selectedCoin?.current_price ?? 0)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: t.textSub, textTransform: "uppercase", letterSpacing: 1 }}>24H Range</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{chartRangeText}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["btc", "eth", "sol", "link", "okb"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      background: activeTab === tab ? (chartTrendUp ? t.greenSoft : t.redSoft) : "transparent",
                      border: `1px solid ${activeTab === tab ? (chartTrendUp ? t.greenGlow : `${t.red}33`) : t.cardBorder}`,
                      color: activeTab === tab ? (chartTrendUp ? t.green : t.red) : t.textMuted,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "6px 14px",
                      borderRadius: 10,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      boxShadow: activeTab === tab ? `0 6px 16px ${chartTrendUp ? t.greenGlow : `${t.red}22`}` : "none",
                    }}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={chartFillTop} stopOpacity={1} />
                    <stop offset="100%" stopColor={chartFillBottom} stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.gridStroke} strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: t.textSub }} axisLine={false} tickLine={false} interval={3} />
                <YAxis tick={{ fontSize: 10, fill: t.textSub }} axisLine={false} tickLine={false} width={68} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(2)}`} domain={["dataMin - 200", "dataMax + 200"]} />
                <Tooltip content={<ChartTooltipCard dark={dark} changeText={chartDeltaText} />} cursor={{ stroke: chartStroke, strokeOpacity: 0.18, strokeDasharray: "4 4" }} />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={chartStroke}
                  strokeWidth={2.6}
                  fill="url(#cg)"
                  dot={false}
                  activeDot={{ r: 5, stroke: chartStroke, strokeWidth: 2, fill: dark ? "#0b1120" : "#ffffff" }}
                  animationDuration={600}
                />
              </AreaChart>
            </ResponsiveContainer>
            {chartLoading && (
              <div style={{ fontSize: 10, color: t.textSub, marginTop: 8 }}>Refreshing chart data...</div>
            )}
          </GlassCard>
        </div>

        {/* ── Transaction Feed — REAL TXS ONLY ── */}
        <div style={{ animation: "fadeUp 0.5s ease 0.3s both" }}>
          <GlassCard style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: `1px solid ${t.cardBorder}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Onchain Activity</div>
                <div style={{ fontSize: 10, color: t.textSub, marginTop: 2 }}>
                  Transactions executed by the AI agent via okx-agentic-wallet on X Layer Mainnet
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 10, color: t.textSub }}>auto-refresh 5s</div>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, animation: "ping 2s infinite" }} />
              </div>
            </div>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: tableColumns, gap: 10, padding: "10px 18px", fontSize: 10, fontWeight: 600, color: t.textSub, letterSpacing: 1, textTransform: "uppercase", borderBottom: `1px solid ${t.cardBorder}` }}>
              {isMobile ? (
                <>
                  <span>TX Hash</span>
                  <span style={{ textAlign: "right" as const }}>Status</span>
                </>
              ) : (
                <>
                  <span>TX Hash</span><span>Skill</span><span>Route</span><span>Amount</span><span>Status</span><span>Time</span>
                </>
              )}
            </div>
            {transactions.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center" as const, fontSize: 12, color: t.textMuted }}>
                No transactions yet. Run the agent to see real onchain activity.
              </div>
            ) : (
              transactions.map((tx, i) => <TxRow key={tx.hash} tx={tx} dark={dark} isLatest={i === 0} compact={isMobile} />)
            )}
          </GlassCard>
        </div>

        {/* ── Footer with Wallet Address ── */}
        <div style={{ display: "flex", flexDirection: isTablet ? "column" : "row", alignItems: isTablet ? "stretch" : "center", justifyContent: "space-between", gap: 14, marginTop: 28, animation: "fadeUp 0.5s ease 0.4s both" }}>
          {/* Agent wallet */}
          <GlassCard style={{ padding: "12px 18px", display: "flex", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: 14 }}>
            <div>
              <div style={{ fontSize: 10, color: t.textSub, letterSpacing: 1, textTransform: "uppercase", marginBottom: 3 }}>Agent Wallet</div>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: t.text, fontWeight: 500 }}>{shortAddr(walletAddr)}</div>
            </div>
            <a
              href={walletUrl(walletAddr)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: t.accent, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, padding: "6px 14px", borderRadius: 8, textDecoration: "none", fontWeight: 600, whiteSpace: "nowrap" as const }}
            >
              View Wallet ↗
            </a>
          </GlassCard>

          {/* Footer credit */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: isTablet ? "center" : "flex-start", gap: 10 }}>
            <a
              href="https://x.com/Ritesh5969"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
            >
              <img
                src="https://pbs.twimg.com/profile_images/1944572785373728768/Qc4iOnla_400x400.jpg"
                alt="Ritesh5969"
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: `1px solid ${t.cardBorder}` }}
              />
              <div style={{ fontSize: 10, color: t.textSub, letterSpacing: 1.2, textAlign: "center" as const }}>
                Built by <span style={{ color: t.accent, fontWeight: 600 }}>Ritesh5969</span>
              </div>
            </a>
          </div>

          {/* Last refresh indicator */}
          <div style={{ fontSize: 10, color: t.textSub, textAlign: isTablet ? "left" as const : "right" as const }}>
            <div>Refreshes every 5s</div>
            {agentStatus?.lastRun ? <div>Last agent run: {agentStatus.lastRunAgo}</div> : null}
          </div>
        </div>

      </main>
    </div>
  );
}
