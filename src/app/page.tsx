"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import {
  Table as ShadcnTable,
  TableHeader as ShadcnTableHeader,
  TableBody as ShadcnTableBody,
  TableHead as ShadcnTableHead,
  TableRow as ShadcnTableRow,
  TableCell as ShadcnTableCell,
} from "@/components/ui/table";

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

// Extract change value for momentum rule gating
function extractChangeFromReason(reason?: string) {
  const match = (reason ?? "").match(/24h:\s*(-?\d+(?:\.\d+)?)%/i);
  return match ? Number(match[1]) : null;
}

// ─── Theme ────────────────────────────────────────────────────────────────────

const DARK = {
  bg: "#090d16",
  card: "#0f172a",
  cardBorder: "rgba(255, 255, 255, 0.06)",
  cardBorderHover: "rgba(59, 130, 246, 0.4)",
  cardShadow: "0 4px 20px rgba(0, 0, 0, 0.35)",
  cardShadowHover: "0 10px 30px rgba(59, 130, 246, 0.15)",
  text: "#f9fafb",
  textMuted: "#d1d5db",
  textSub: "#9ca3af",
  accent: "#3b82f6",
  accentGlow: "rgba(59, 130, 246, 0.3)",
  accentSoft: "rgba(59, 130, 246, 0.1)",
  purple: "#818cf8",
  purpleGlow: "rgba(129, 140, 248, 0.3)",
  purpleSoft: "rgba(129, 140, 248, 0.1)",
  green: "#34d399",
  greenGlow: "rgba(52, 211, 153, 0.3)",
  greenSoft: "rgba(52, 211, 153, 0.1)",
  red: "#f87171",
  redSoft: "rgba(248, 113, 113, 0.1)",
  amber: "#fbbf24",
  amberSoft: "rgba(251, 191, 36, 0.1)",
  headerBg: "rgba(9, 13, 22, 0.85)",
  tooltipBg: "#0f172a",
  gridStroke: "#1e293b",
  chartStroke: "#3b82f6",
};

const LIGHT = {
  bg: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  card: "#ffffff",
  cardBorder: "#e2e8f0",
  cardBorderHover: "rgba(59, 130, 246, 0.3)",
  cardShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05), 0 10px 15px -3px rgba(100, 116, 139, 0.05)",
  cardShadowHover: "0 10px 25px -5px rgba(59, 130, 246, 0.12), 0 8px 10px -6px rgba(59, 130, 246, 0.12)",
  text: "#1e2937",
  textMuted: "#4b5563",
  textSub: "#6b7280",
  accent: "#3b82f6",
  accentGlow: "rgba(59, 130, 246, 0.15)",
  accentSoft: "#eff6ff",
  purple: "#6366f1",
  purpleGlow: "rgba(99, 102, 241, 0.15)",
  purpleSoft: "#f0f2ff",
  green: "#10b981",
  greenGlow: "rgba(16, 185, 129, 0.15)",
  greenSoft: "#ecfdf5",
  red: "#ef4444",
  redSoft: "#fef2f2",
  amber: "#f59e0b",
  amberSoft: "#fffbeb",
  headerBg: "rgba(255, 255, 255, 0.8)",
  tooltipBg: "#ffffff",
  gridStroke: "#f1f5f9",
  chartStroke: "#3b82f6",
};

// ─── Shadcn-powered Reusable Components ───────────────────────────────────────

function GlassCard({ children, style = {}, className = "" }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <Card 
      className={cn("premium-card shadow-sm border-[1px] rounded-[24px] p-6", className)}
      style={{
        borderColor: "var(--card-border)", 
        background: "var(--card)",
        boxShadow: "var(--card-shadow)",
        ...style,
      }}
    >
      {children}
    </Card>
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
    <GlassCard style={{ padding: "24px 28px" }}>
      <div style={{ fontSize: 11, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color: t.text, letterSpacing: "-0.03em", marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 13, color: neg ? t.red : t.green, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10 }}>{neg ? "▼" : "▲"}</span> {delta}
      </div>
    </GlassCard>
  );
}

function MarketMoverCard({ coin, dark }: { coin: CoinData; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  const up = coin.price_change_percentage_24h >= 0;
  const pillBg = up ? t.greenSoft : t.redSoft;
  const pillBorder = up ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.2)";
  return (
    <div style={{
      display: "flex", 
      alignItems: "center", 
      gap: 14, 
      padding: "14px 18px", 
      borderRadius: 16,
      background: dark ? "rgba(255,255,255,0.02)" : "#f8fafc",
      border: `1px solid ${t.cardBorder}`,
      transition: "all 0.2s ease"
    }}
    className="hover:scale-[1.01] hover:border-slate-300"
    >
      {coin.image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={coin.image} alt={coin.symbol} style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0 }} />
        : <div style={{ width: 34, height: 34, borderRadius: "50%", background: t.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: t.accent, flexShrink: 0 }}>{coin.symbol.slice(0, 2).toUpperCase()}</div>
      }
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{coin.name}</div>
        <div style={{ fontSize: 12, color: t.textSub, marginTop: 2, fontWeight: 500 }}>${coin.current_price.toLocaleString()}</div>
      </div>
      <Badge variant="outline" style={{ borderColor: pillBorder, background: pillBg, color: up ? t.green : t.red }} className="font-bold text-xs px-2.5 py-0.5 rounded-full">
        {up ? "▲" : "▼"} {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
      </Badge>
    </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: `0 4px 12px ${t.accentGlow}` }}>🧠</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.text, letterSpacing: "-0.02em" }}>AI Suggestion</div>
            <div style={{ fontSize: 12, color: t.textSub, marginTop: 2, fontWeight: 500 }}>Groq LLaMA 3.3 · okx-dex-market skill</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge variant="outline" style={{ borderColor: `${statusColor}35`, background: `${statusColor}12`, color: statusColor }} className="font-bold text-xs px-3 py-1 rounded-full">
            {statusLabel}
          </Badge>
          {action && !loading && (
            <Badge variant="outline" style={{ borderColor: `${actionColor}40`, background: `${actionColor}15`, color: actionColor, boxShadow: `0 0 10px ${actionColor}30` }} className="font-bold text-xs px-3.5 py-1 rounded-md">
              {action === "BUY" ? "📈" : action === "SELL" ? "📉" : "⏸"} {action}
            </Badge>
          )}
          {confidence !== null && !loading && (
            <Badge variant="outline" style={{ borderColor: t.accentGlow, background: t.accentSoft, color: t.accent }} className="font-semibold text-xs px-3.5 py-1 rounded-md">
              {confidence}% confidence
            </Badge>
          )}
          <button 
            onClick={() => onRefresh()} 
            style={{ 
              background: t.accentSoft, 
              border: `1px solid ${t.accentGlow}`, 
              color: t.accent, 
              fontSize: 13, 
              padding: "8px 16px", 
              borderRadius: 10, 
              cursor: "pointer", 
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="hover:scale-[1.02] active:scale-[0.98]"
          >
            <span style={{ fontSize: 14 }}>↻</span> Refresh Analysis
          </button>
        </div>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: t.red, marginBottom: 10, padding: "10px 12px", borderRadius: 10, background: t.redSoft, border: `1px solid ${t.red}25` }}>
          {error}
        </div>
      )}
      <div style={{ fontSize: 12, color: t.textSub, marginBottom: 13, fontWeight: 500 }}>
        Refreshing this panel updates the market suggestion only. Executed trades are shown separately in Last Executed Trade.
      </div>
      <div style={{ 
        position: "relative", 
        fontSize: "14.5px", 
        lineHeight: "1.75", 
        color: t.textMuted, 
        whiteSpace: "pre-wrap", 
        padding: "20px 24px", 
        borderRadius: 16, 
        background: dark ? "rgba(255,255,255,0.02)" : "#f8fafc", 
        border: `1px solid ${t.cardBorder}`, 
        minHeight: contentBoxHeight,
        fontFamily: "'Inter', sans-serif"
      }}>
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
    { label: "BUY threshold", value: "≥ 1.5% 24h change" },
    { label: "SELL threshold", value: "< -4% 24h change" },
    { label: "Neutral band", value: "|24h| < 1% ⇒ HOLD" },
    { label: "Trade cap", value: "0.001 OKB max" },
    { label: "Gas buffer", value: "0.001 OKB min extra" },
  ];

  return (
    <GlassCard style={{ padding: "24px 26px", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <span style={{ fontSize: 14 }}>🛡️</span>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Quant Safety Rules
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rules.map((rule) => (
          <div
            key={rule.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              paddingBottom: 10,
              borderBottom: `1px solid ${t.cardBorder}`,
            }}
          >
            <span style={{ fontSize: 13, color: t.textSub, fontWeight: 500 }}>{rule.label}</span>
            <span style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>{rule.value}</span>
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
      <GlassCard style={{ padding: "24px 26px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 14 }}>
          Cycle Result
        </div>
        <div style={{ fontSize: 13, color: t.textMuted }}>Run the agent once to see the latest rule trace.</div>
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
        ? move >= 1.5
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
      bg: movePass === null ? (dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)") : movePass ? t.greenSoft : "rgba(251,191,36,0.06)",
    },
    {
      label: "Final result",
      value: status.lastExecution === "executed" ? `${status.lastAction} executed` : `${status.lastAction} skipped`,
      tone: status.lastExecution === "executed" ? t.green : t.text,
      bg: status.lastExecution === "executed" ? t.greenSoft : (dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
    },
  ];

  return (
    <GlassCard style={{ padding: "24px 26px", display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase" }}>Cycle Result</div>
          <div style={{ fontSize: 11, color: t.textSub, marginTop: 3, fontWeight: 500 }}>Latest rule trace for the most recent agent cycle</div>
        </div>
        <Badge variant="outline" style={{ borderColor: t.accentGlow, background: t.accentSoft, color: t.accent }} className="font-bold text-xs px-2.5 py-0.5 rounded-full">
          #{status.cycleCount}
        </Badge>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "130px minmax(0, 1fr)",
              gap: 12,
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: 14,
              background: row.bg,
              border: `1px solid ${t.cardBorder}`,
            }}
          >
            <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{row.label}</div>
            <div style={{ fontSize: 14, color: row.tone, fontWeight: 700 }}>{row.value}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 18, fontSize: 13, color: t.textMuted, lineHeight: 1.6, fontWeight: 400 }}>
        {status.lastReason || "Rule trace unavailable for this cycle."}
      </div>

      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <div style={{ padding: "12px", borderRadius: 14, background: dark ? "rgba(255,255,255,0.03)" : "#f8fafc", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 10, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 4 }}>Execution</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: status.lastExecution === "executed" ? t.green : t.text }}>
            {status.lastExecution === "executed" ? "Executed" : "Skipped"}
          </div>
        </div>
        <div style={{ padding: "12px", borderRadius: 14, background: dark ? "rgba(255,255,255,0.03)" : "#f8fafc", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 10, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 4 }}>Tx State</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: status.lastTxHash ? t.accent : t.text }}>
            {status.lastTxHash ? shortHash(status.lastTxHash) : "No tx"}
          </div>
        </div>
        <div style={{ padding: "12px", borderRadius: 14, background: dark ? "rgba(255,255,255,0.03)" : "#f8fafc", border: `1px solid ${t.cardBorder}` }}>
          <div style={{ fontSize: 10, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 4 }}>Updated</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
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
    info:     { color: t.textMuted, icon: "•", bg: dark ? "rgba(255,255,255,0.02)" : "#f8fafc" },
  };
  return (
    <GlassCard style={{ padding: "24px 26px", display: "flex", flexDirection: "column", flex: 1, minHeight: 250 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 16 }}>AI Reasoning Timeline</div>
      <div style={{ maxHeight: 210, overflowY: "auto", WebkitOverflowScrolling: "touch", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
        {events.length === 0 && <div style={{ fontSize: 13, color: t.textMuted, padding: "20px 0", textAlign: "center" as const }}>Waiting for agent cycle...</div>}
        {events.map((ev, i) => {
          const c = cfg[ev.type];
          return (
            <div key={ev.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 12, background: i === 0 ? c.bg : "transparent", border: `1px solid ${i === 0 ? c.color + "25" : "transparent"}`, animation: i === 0 ? "slideIn 0.3s ease" : "none" }}>
              <span style={{ fontSize: 11, color: t.textSub, fontFamily: "monospace", flexShrink: 0, marginTop: 2 }}>{ev.time}</span>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: c.bg, border: `1px solid ${c.color}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: c.color, flexShrink: 0, fontWeight: 700 }}>{c.icon}</span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: i === 0 ? t.text : t.textMuted, flex: 1, fontWeight: i === 0 ? 600 : 400 }}>{ev.message}</span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function LatestTxMonitor({ tx, dark }: { tx: Transaction | null; dark: boolean }) {
  const t = dark ? DARK : LIGHT;
  if (!tx) return (
    <GlassCard style={{ padding: "24px 26px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 14 }}>Last Executed Trade</div>
      <div style={{ fontSize: 13, color: t.textMuted, padding: "24px 20px", textAlign: "center" as const }}>No transactions yet</div>
    </GlassCard>
  );
  return (
    <GlassCard style={{ padding: "24px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PulsingDot color={t.green} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase" }}>Last Executed Trade</div>
            <div style={{ fontSize: 11, color: t.textSub, marginTop: 3, fontWeight: 500 }}>Latest completed autonomous action</div>
          </div>
        </div>
        <span style={{ fontSize: 11, color: t.green, background: t.greenSoft, border: `1px solid ${t.greenGlow}`, padding: "3px 10px", borderRadius: 999, fontWeight: 700 }}>CONFIRMED</span>
      </div>
      <div style={{ padding: "18px 20px", borderRadius: 16, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, boxShadow: dark ? `0 4px 16px ${t.accentGlow}` : "none" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: t.text, marginBottom: 8, letterSpacing: "-0.02em" }}>{tx.type} {tx.from} → {tx.to}</div>
        <div style={{ fontSize: 13.5, color: t.textMuted, marginBottom: 14, fontWeight: 500 }}>amount: <span style={{ fontWeight: 600, color: t.text }}>{tx.amount}</span></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <a href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: t.accent, fontFamily: "monospace", textDecoration: "none", fontWeight: 700, borderBottom: `1px dashed ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", position: "relative", zIndex: 1 }}>
            tx: {shortHash(tx.hash)} ↗
          </a>
          <span style={{ fontSize: 11.5, color: t.textSub, fontWeight: 500 }}>{tx.timeAgo}</span>
        </div>
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
      // Keep static falls if fetch fails.
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
      // Keep previous chart on network error
    } finally {
      setChartLoading(false);
    }
  }, [activeTab]);

  // ── Fetch wallet portfolio balances (server-side to avoid CORS) ───────────
  const fetchPortfolio = useCallback(async () => {
    try {
      const res  = await fetch("/api/portfolio", { cache: "no-store" });
      const data = await res.json();
      if (data.error && !data.okb) return;
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
  const mainPadding = isMobile ? "24px 16px 36px" : isTablet ? "36px 32px 48px" : "40px 48px 64px";
  const pageTransition = "background 0.3s ease, color 0.3s ease";
  const selectedCoin = marketData.find((coin) => coin.symbol === activeTab) ?? marketData[0];
  const latestChartPoint = chartData[chartData.length - 1] ?? null;
  const chartTrendUp = (selectedCoin?.price_change_percentage_24h ?? 0) >= 0;
  const chartStroke = t.accent;
  const chartFillTop = "rgba(59, 130, 246, 0.16)";
  const chartFillBottom = "rgba(59, 130, 246, 0.01)";
  const chartDeltaText = `${chartTrendUp ? "+" : ""}${(selectedCoin?.price_change_percentage_24h ?? 0).toFixed(2)}%`;
  const chartRangeText = selectedCoin ? `${formatPriceLabel(selectedCoin.current_price * 0.985)} - ${formatPriceLabel(selectedCoin.current_price * 1.015)}` : "Waiting for range";

  const cssVars = {
    "--bg": t.bg,
    "--card": t.card,
    "--card-border": t.cardBorder,
    "--card-border-hover": t.cardBorderHover,
    "--card-shadow": t.cardShadow,
    "--card-shadow-hover": t.cardShadowHover,
    "--text": t.text,
    "--text-muted": t.textMuted,
    "--text-sub": t.textSub,
    "--accent": t.accent,
  } as React.CSSProperties;

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", transition: pageTransition, overflowX: "hidden", WebkitTapHighlightColor: "transparent", touchAction: "manipulation", ...cssVars }}>
      <style>{`
        @keyframes ping { 75%,100%{transform:scale(2);opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        * { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* ── Header ── */}
      <header style={{ 
        display: "flex", 
        flexDirection: headerLayout, 
        alignItems: isTablet ? "stretch" : "center", 
        justifyContent: "space-between", 
        gap: isTablet ? 16 : 0, 
        padding: isMobile ? "16px 20px" : isTablet ? "20px 32px" : "18px 48px", 
        background: t.headerBg, 
        backdropFilter: "blur(12px)", 
        WebkitBackdropFilter: "blur(12px)", 
        borderBottom: `1px solid ${t.cardBorder}`, 
        position: "sticky", 
        top: 0, 
        zIndex: 100,
        boxShadow: dark ? "none" : "0 1px 3px rgba(0, 0, 0, 0.02)"
      }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#fff", boxShadow: `0 4px 16px ${t.accentGlow}` }}>X</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.text, letterSpacing: "-0.03em" }}>Xpulse AI</div>
            <div style={{ fontSize: 10, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", fontWeight: 600, marginTop: 2 }}>Autonomous · X Layer Mainnet</div>
          </div>
        </div>

        {/* Chain badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: isTablet ? "flex-start" : "center" }}>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="outline" className="rounded-full px-3.5 py-1.5 font-semibold text-xs cursor-help transition-colors" style={{ borderColor: t.accentGlow, background: t.accentSoft, color: t.accent }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent, display: "inline-block", marginRight: 6 }} />
                X Layer Mainnet
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="bg-slate-900 text-white rounded-lg p-2 text-xs shadow-md border-0">
              Chain ID 196 (OKX Layer 2 Blockchain)
            </TooltipContent>
          </Tooltip>

          <Badge variant="outline" className="rounded-full px-3.5 py-1.5 font-semibold text-xs transition-colors" style={{ borderColor: t.purpleGlow, background: t.purpleSoft, color: t.purple }}>
            ⚙ Onchain OS
          </Badge>

          {agentStatus && (
            <Badge variant="outline" className="rounded-full px-3.5 py-1.5 font-medium text-xs transition-colors" style={{ borderColor: t.cardBorder, background: dark ? "rgba(255,255,255,0.04)" : "#ffffff", color: t.textMuted }}>
              {agentStatus.cycleCount} cycles
            </Badge>
          )}
        </div>

        {/* Right: Agent status + theme toggle */}
        <div style={{ display: "flex", alignItems: isMobile ? "stretch" : "center", gap: 12, flexDirection: isMobile ? "column" : "row", justifyContent: isTablet ? "space-between" : "flex-end" }}>
          <div style={{ 
            display: "flex", 
            alignItems: "center", 
            gap: 12, 
            background: isActive ? t.greenSoft : t.amberSoft, 
            border: `1px solid ${isActive ? t.greenGlow : `${t.amber}33`}`, 
            borderRadius: 14, 
            padding: "10px 18px", 
            width: isMobile ? "100%" : "auto",
            boxShadow: isActive ? `0 4px 12px ${t.greenGlow}` : "none",
            transition: "all 0.3s ease"
          }}>
            {isActive ? <PulsingDot color={t.green} /> : <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.amber, display: "inline-block" }} />}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? t.green : t.amber, letterSpacing: "0.02em" }}>
                {isActive ? "AGENT RUNNING" : "AGENT IDLE"}
              </div>
              <div style={{ fontSize: 10, color: t.textSub, marginTop: 2, fontWeight: 500 }}>
                Cycle completed: {lastTradeAgo}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, width: isMobile ? "100%" : "auto" }}>
            <button
              onClick={runAgent}
              disabled={agentRunning}
              style={{
                background: agentRunning ? t.accentSoft : `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
                border: "none",
                borderRadius: 12,
                padding: isMobile ? "12px 20px" : "10px 20px",
                cursor: agentRunning ? "not-allowed" : "pointer",
                color: "#fff",
                fontSize: isMobile ? 14 : 13,
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: agentRunning ? "none" : `0 4px 16px ${t.accentGlow}`,
                flex: isMobile ? 1 : "initial",
              }}
              className="hover:scale-[1.02] hover:brightness-105 active:scale-[0.98]"
            >
              <span style={{ fontSize: 14, animation: agentRunning ? "spin 1s linear infinite" : "none", display: "inline-block", fontWeight: 700 }}>
                {agentRunning ? "◌" : "⚡"}
              </span>
              {agentRunning ? "Running..." : "Run Agent"}
            </button>
            <button 
              onClick={() => setDark(d => !d)} 
              style={{ 
                background: dark ? "rgba(255,255,255,0.06)" : "#ffffff", 
                border: `1px solid ${t.cardBorder}`, 
                borderRadius: 12, 
                padding: isMobile ? "12px 16px" : "10px 16px", 
                cursor: "pointer", 
                display: "inline-flex", 
                alignItems: "center", 
                justifyContent: "center", 
                gap: 8, 
                color: t.text, 
                fontSize: isMobile ? 14 : 13, 
                fontWeight: 600,
                boxShadow: dark ? "none" : "0 1px 2px rgba(0, 0, 0, 0.05)",
                transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                flex: isMobile ? 1 : "initial" 
              }}
              className="hover:bg-slate-50 active:scale-[0.98]"
            >
              <span style={{ fontSize: 14 }}>{dark ? "☀️" : "🌙"}</span>
              <span>{dark ? "Light Mode" : "Dark Mode"}</span>
            </button>
          </div>
        </div>
      </header>

      <main style={{ padding: mainPadding, maxWidth: 1440, margin: "0 auto" }}>

        {/* ── Stats row ── */}
        <div style={{ display: "grid", gridTemplateColumns: statsGridColumns, gap: 24, marginBottom: 32, animation: "fadeUp 0.5s ease" }}>
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
          <GlassCard style={{ padding: "24px 28px" }}>
            <div style={{ fontSize: 11, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>Agent Portfolio</div>
            <div style={{ fontSize: 11, color: t.textSub, marginBottom: 12, fontWeight: 500 }}>{formatUpdatedAt(portfolioUpdatedAt)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: t.textMuted, fontWeight: 500 }}>OKB</span>
                <span style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>
                  {portfolio.okb.toFixed(4)}
                  <span style={{ fontSize: 11, color: t.textSub, marginLeft: 4, fontWeight: 500 }}>(${portfolio.okbUsd.toFixed(2)})</span>
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: t.textMuted, fontWeight: 500 }}>WOKB</span>
                <span style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>
                  {portfolio.wokb.toFixed(4)}
                  <span style={{ fontSize: 11, color: t.textSub, marginLeft: 4, fontWeight: 500 }}>(${portfolio.wokbUsd.toFixed(2)})</span>
                </span>
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${t.cardBorder}`, paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: t.textSub, fontWeight: 500 }}>Total Value</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: t.green }}>${portfolio.totalUsd.toFixed(2)}</span>
            </div>
          </GlassCard>
        </div>

        {/* ── AI Insight + Latest TX ── */}
        <div style={{ display: "grid", gridTemplateColumns: insightGridColumns, alignItems: "stretch", gap: 24, marginBottom: 32, animation: "fadeUp 0.5s ease 0.1s both" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, minHeight: "100%", height: "100%" }}>
            <AIInsightPanel insight={insight} loading={insightLoading} error={insightError} updatedAt={insightUpdatedAt} onRefresh={fetchInsight} dark={dark} />
            <CycleTraceCard status={agentStatus} dark={dark} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24, minHeight: "100%" }}>
            <TimelinePanel events={timeline} dark={dark} />
            <QuantRuleCard dark={dark} />
            <LatestTxMonitor tx={latestTx} dark={dark} />
          </div>
        </div>

        {/* ── Market + Chart + Timeline ── */}
        <div style={{ display: "grid", gridTemplateColumns: marketGridColumns, gap: 24, marginBottom: 32, animation: "fadeUp 0.5s ease 0.2s both" }}>
          <GlassCard style={{ padding: "24px 26px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 14 }}>Market Movers</div>
            <div style={{ fontSize: 11, color: t.textSub, marginBottom: 14, fontWeight: 500 }}>{formatUpdatedAt(marketUpdatedAt)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {marketData.map(c => <MarketMoverCard key={c.id} coin={c} dark={dark} />)}
            </div>
          </GlassCard>

          <GlassCard style={{ padding: "24px 26px" }}>
            <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 12 : 0, marginBottom: 18 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 3 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Price Chart</div>
                  {selectedCoin && (
                    <Badge variant="outline" style={{ borderColor: chartTrendUp ? t.greenGlow : `${t.red}33`, background: chartTrendUp ? t.greenSoft : t.redSoft, color: chartTrendUp ? t.green : t.red }} className="font-bold text-xs px-2.5 py-0.5 rounded-full">
                      {selectedCoin.symbol.toUpperCase()} {chartDeltaText}
                    </Badge>
                  )}
                </div>
                <div style={{ fontSize: 11, color: t.textSub, marginTop: 2, fontWeight: 500 }}>24H Performance · {formatUpdatedAt(chartUpdatedAt)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
                  <div>
                    <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>Latest Price</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: t.text, letterSpacing: "-0.03em", marginTop: 4 }}>
                      {formatPriceLabel(latestChartPoint?.price ?? selectedCoin?.current_price ?? 0)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: t.textSub, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>24H Trading Range</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.textMuted, marginTop: 8 }}>
                      {chartRangeText}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Shadcn Tabs integration */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-fit">
                <TabsList className="bg-muted p-[3px] rounded-lg flex flex-wrap gap-1">
                  {["btc", "eth", "sol", "link", "okb"].map(tab => (
                    <TabsTrigger
                      key={tab}
                      value={tab}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all"
                      style={{
                        color: activeTab === tab ? t.accent : t.textMuted,
                        background: activeTab === tab ? t.accentSoft : "transparent",
                        borderColor: activeTab === tab ? t.accentGlow : "transparent",
                        borderWidth: "1px",
                      }}
                    >
                      {tab.toUpperCase()}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
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
                <RechartsTooltip content={<ChartTooltipCard dark={dark} changeText={chartDeltaText} />} cursor={{ stroke: chartStroke, strokeOpacity: 0.18, strokeDasharray: "4 4" }} />
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
              <div style={{ fontSize: 11, color: t.textSub, marginTop: 8, fontWeight: 500 }}>Refreshing chart data...</div>
            )}
          </GlassCard>
        </div>

        {/* ── Transaction Feed — REAL TXS ONLY ── */}
        <div style={{ animation: "fadeUp 0.5s ease 0.3s both" }}>
          <GlassCard style={{ overflow: "hidden", padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: `1px solid ${t.cardBorder}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Onchain Activity</div>
                <div style={{ fontSize: 12, color: t.textSub, marginTop: 2, fontWeight: 500 }}>
                  Transactions executed by the AI agent via okx-agentic-wallet on X Layer Mainnet
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 11, color: t.textSub, fontWeight: 500 }}>auto-refresh 5s</div>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.green, animation: "ping 2s infinite" }} />
              </div>
            </div>
            
            {/* Shadcn UI Table component refactor */}
            <ShadcnTable className="w-full">
              <ShadcnTableHeader className="border-b" style={{ borderColor: t.cardBorder }}>
                <ShadcnTableRow className="hover:bg-transparent">
                  {isMobile ? (
                    <>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider pl-6" style={{ color: t.textSub }}>TX Hash</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider text-right pr-6" style={{ color: t.textSub }}>Status</ShadcnTableHead>
                    </>
                  ) : (
                    <>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider pl-6" style={{ color: t.textSub }}>TX Hash</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider" style={{ color: t.textSub }}>Skill</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider" style={{ color: t.textSub }}>Route</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider" style={{ color: t.textSub }}>Amount</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider" style={{ color: t.textSub }}>Status</ShadcnTableHead>
                      <ShadcnTableHead className="font-semibold text-xs uppercase tracking-wider pr-6" style={{ color: t.textSub }}>Time</ShadcnTableHead>
                    </>
                  )}
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {transactions.length === 0 ? (
                  <ShadcnTableRow>
                    <ShadcnTableCell colSpan={isMobile ? 2 : 6} className="text-center py-10" style={{ color: t.textMuted }}>
                      No transactions yet. Run the agent to see real onchain activity.
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ) : (
                  transactions.map((tx, i) => {
                    const statusColor = tx.status === "confirmed" ? t.green : t.amber;
                    const statusBg = tx.status === "confirmed" ? t.greenSoft : "rgba(245, 158, 11, 0.08)";
                    const statusBorder = tx.status === "confirmed" ? "rgba(16, 185, 129, 0.2)" : "rgba(245, 158, 11, 0.2)";
                    const isLatest = i === 0;

                    return (
                      <ShadcnTableRow
                        key={tx.hash}
                        className="transition-colors border-b"
                        style={{
                          borderColor: t.cardBorder,
                          background: isLatest ? (dark ? "rgba(59, 130, 246, 0.04)" : "rgba(59, 130, 246, 0.02)") : "transparent",
                        }}
                      >
                        {isMobile ? (
                          <>
                            <ShadcnTableCell className="py-4 pl-6">
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                <a
                                  href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
                                  style={{ color: t.accent, fontFamily: "monospace", fontSize: 12, textDecoration: "none", borderBottom: `1px dashed ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", fontWeight: 600 }}
                                >
                                  {shortHash(tx.hash)} ↗
                                </a>
                                <span style={{ color: t.text, fontWeight: 600, fontSize: 12 }}>{tx.from} → {tx.to}</span>
                                <span style={{ color: t.textSub, fontSize: 11 }}>{tx.amount} · {tx.timeAgo}</span>
                              </div>
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4 pr-6 text-right">
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                                <Badge variant="outline" style={{ borderColor: "rgba(99, 102, 241, 0.15)", background: t.purpleSoft, color: t.purple }} className="font-bold text-[10px] px-2 py-0.5 rounded-md">
                                  {tx.type}
                                </Badge>
                                <Badge variant="outline" style={{ borderColor: statusBorder, background: statusBg, color: statusColor }} className="font-bold text-[10px] px-2 py-0.5 rounded-md">
                                  {tx.status}
                                </Badge>
                              </div>
                            </ShadcnTableCell>
                          </>
                        ) : (
                          <>
                            <ShadcnTableCell className="py-4 pl-6">
                              <a
                                href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"
                                style={{ color: t.accent, fontFamily: "monospace", fontSize: 12, textDecoration: "none", borderBottom: `1px dashed ${t.accentGlow}`, paddingBottom: 1, display: "inline-flex", alignItems: "center", gap: 4, width: "fit-content", fontWeight: 600 }}
                              >
                                {shortHash(tx.hash)} ↗
                              </a>
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4">
                              <Badge variant="outline" style={{ borderColor: "rgba(99, 102, 241, 0.15)", background: t.purpleSoft, color: t.purple }} className="font-bold text-[10px] px-2.5 py-0.5 rounded-md">
                                {tx.type}
                              </Badge>
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4 font-mono text-xs" style={{ color: t.textMuted }}>
                              {tx.from} → {tx.to}
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4 font-semibold" style={{ color: t.text }}>
                              {tx.amount}
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4">
                              <Badge variant="outline" style={{ borderColor: statusBorder, background: statusBg, color: statusColor }} className="font-bold text-[10px] px-2.5 py-0.5 rounded-md">
                                {tx.status}
                              </Badge>
                            </ShadcnTableCell>
                            <ShadcnTableCell className="py-4 pr-6 text-xs" style={{ color: t.textSub }}>
                              {tx.timeAgo}
                            </ShadcnTableCell>
                          </>
                        )}
                      </ShadcnTableRow>
                    );
                  })
                )}
              </ShadcnTableBody>
            </ShadcnTable>
          </GlassCard>
        </div>

        {/* ── Footer with Wallet Address ── */}
        <div style={{ display: "flex", flexDirection: isTablet ? "column" : "row", alignItems: isTablet ? "stretch" : "center", justifyContent: "space-between", gap: 24, marginTop: 48, paddingBottom: 24, borderTop: `1px solid ${t.cardBorder}`, paddingTop: 24, animation: "fadeUp 0.5s ease 0.4s both" }}>
          {/* Agent wallet */}
          <GlassCard style={{ padding: "16px 20px", display: "flex", alignItems: isMobile ? "stretch" : "center", flexDirection: isMobile ? "column" : "row", gap: 18, border: `1px solid ${t.cardBorder}` }}>
            <div>
              <div style={{ fontSize: 11, color: t.textSub, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>Agent Wallet Address</div>
              <div style={{ fontSize: 13, fontFamily: "monospace", color: t.text, fontWeight: 600 }}>{shortAddr(walletAddr)}</div>
            </div>
            <a
              href={walletUrl(walletAddr)}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: t.accent, background: t.accentSoft, border: `1px solid ${t.accentGlow}`, padding: "8px 16px", borderRadius: 10, textDecoration: "none", fontWeight: 700, whiteSpace: "nowrap" as const, display: "inline-flex", alignItems: "center", gap: 4, transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)" }}
              className="hover:scale-[1.02]"
            >
              View Wallet ↗
            </a>
          </GlassCard>

          {/* Footer credit */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: isTablet ? "center" : "flex-start", gap: 12 }}>
            <a
              href="https://x.com/Ritesh5969"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}
            >
              <img
                src="https://pbs.twimg.com/profile_images/1944572785373728768/Qc4iOnla_400x400.jpg"
                alt="Ritesh5969"
                style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover", border: `1px solid ${t.cardBorder}`, boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)" }}
              />
              <div style={{ fontSize: 11, color: t.textSub, letterSpacing: "0.05em", fontWeight: 500 }}>
                Built by <span style={{ color: t.accent, fontWeight: 700 }}>Ritesh5969</span>
              </div>
            </a>
          </div>

          {/* Last refresh indicator */}
          <div style={{ fontSize: 11, color: t.textSub, textAlign: isTablet ? "left" as const : "right" as const, fontWeight: 500 }}>
            <div>Refreshes automatically every 5s</div>
            {agentStatus?.lastRun ? <div style={{ marginTop: 4 }}>Last agent run: {agentStatus.lastRunAgo}</div> : null}
          </div>
        </div>

      </main>
    </div>
  );
}
