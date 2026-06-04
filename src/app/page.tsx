"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

import {
  Brain,
  Shield,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Sun,
  Moon,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Info,
  Wallet,
  User,
  Clock
} from "lucide-react";

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

function extractChangeFromReason(reason?: string) {
  const match = (reason ?? "").match(/24h:\s*(-?\d+(?:\.\d+)?)%/i);
  return match ? Number(match[1]) : null;
}

function generateFallbackChart(currentPrice: number, changePercent: number): ChartPoint[] {
  const points: ChartPoint[] = [];
  const hours = 24;
  const startPrice = currentPrice / (1 + changePercent / 100);
  const priceDifference = currentPrice - startPrice;
  const now = new Date();

  for (let i = 0; i < hours; i++) {
    const d = new Date(now.getTime() - (hours - 1 - i) * 60 * 60 * 1000);
    const timeStr = d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });

    const trend = i / (hours - 1);
    const trendPrice = startPrice + priceDifference * trend;
    const wave1 = Math.sin(i * 0.5) * (currentPrice * 0.008);
    const wave2 = Math.cos(i * 0.9) * (currentPrice * 0.003);
    const price = i === hours - 1 ? currentPrice : trendPrice + wave1 + wave2;

    points.push({
      time: timeStr,
      price: Math.max(0.001, price),
    });
  }
  return points;
}

// ─── Theme constants (deprecated but kept for styles fallback) ────────────────

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
      className={cn("premium-card shadow-md border border-border rounded-2xl p-6 bg-card text-card-foreground transition-all duration-300", className)}
      style={style}
    >
      {children}
    </Card>
  );
}

function PulsingDot({ className = "" }: { className?: string }) {
  return (
    <span className={cn("relative flex h-2.5 w-2.5", className)}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
    </span>
  );
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button 
      onClick={handleCopy} 
      className={cn("p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground", className)}
      title="Copy to clipboard"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function StatCard({ label, value, delta, neg, loading, className = "" }: { label: string; value: string; delta: string; neg?: boolean; loading?: boolean; className?: string }) {
  if (loading) {
    return (
      <GlassCard className={cn("p-6 transition-all duration-300", className)}>
        <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2.5">
          {label}
        </div>
        <div className="h-8 w-24 bg-muted/40 rounded-lg animate-pulse mb-3" />
        <div className="h-4.5 w-16 bg-muted/30 rounded-md animate-pulse" />
      </GlassCard>
    );
  }

  const hasTrend = neg !== undefined;

  return (
    <GlassCard className={cn("p-6 transition-all duration-300 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/5", className)}>
      <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
        {label}
      </div>
      <div className="text-3xl font-extrabold tracking-tight font-mono mb-2">
        {value}
      </div>
      <div className={cn(
        "text-xs font-semibold flex items-center gap-1",
        hasTrend ? (neg ? "text-destructive" : "text-emerald-500") : "text-muted-foreground"
      )}>
        {hasTrend && (neg ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />)}
        <span>{delta}</span>
      </div>
    </GlassCard>
  );
}

function MarketMoverCard({ coin, dark }: { coin: CoinData; dark?: boolean }) {
  const up = coin.price_change_percentage_24h >= 0;
  return (
    <div className="flex items-center gap-3.5 p-3 rounded-xl bg-muted/10 border border-border hover:bg-muted/20 transition-all duration-300">
      {coin.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coin.image} alt={coin.symbol} className="w-8 h-8 rounded-full flex-shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
          {coin.symbol.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold truncate">{coin.name}</div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">
          ${coin.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </div>
      </div>
      <Badge 
        variant="outline" 
        className={cn(
          "font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm", 
          up ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-destructive/20 bg-destructive/10 text-destructive"
        )}
      >
        {up ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
        {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
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
  dark?: boolean;
}) {
  const safeInsight = insight ?? "";
  const actionMatch = safeInsight.match(/ACTION:\s*(BUY|SELL|HOLD)/i);
  const action = actionMatch?.[1]?.toUpperCase();
  const confidenceMatch = safeInsight.match(/confidence[:\s]+(\d+)/i);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : null;
  const statusLabel = loading ? "Refreshing" : error ? "Needs attention" : "Live";
  const visibleInsight = safeInsight || "Awaiting market data...";

  return (
    <GlassCard className="p-6 relative overflow-hidden flex flex-col justify-between min-h-[220px]">
      <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-transparent via-accent to-indigo-500" />
      
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-indigo-600 flex items-center justify-center shadow-lg shadow-accent/15">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight">AI Suggestion</h3>
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mt-0.5">Groq LLaMA 3.3 · okx-dex-market skill</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn(
              "font-bold text-[10px] px-2.5 py-0.5 rounded-full",
              loading ? "border-accent/20 bg-accent/10 text-accent" : error ? "border-destructive/20 bg-destructive/10 text-destructive" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
            )}>
              {statusLabel}
            </Badge>
            {action && !loading && (
              <Badge variant="outline" className={cn(
                "font-bold text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-sm",
                action === "BUY" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-500" :
                action === "SELL" ? "border-destructive/30 bg-destructive/15 text-destructive" :
                "border-amber-500/30 bg-amber-500/15 text-amber-500"
              )}>
                {action === "BUY" ? <TrendingUp className="w-3 h-3" /> : action === "SELL" ? <TrendingDown className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {action}
              </Badge>
            )}
            {confidence !== null && !loading && (
              <Badge variant="outline" className="font-bold text-[10px] px-2.5 py-0.5 rounded-full border-accent/20 bg-accent/5 text-accent">
                {confidence}% confidence
              </Badge>
            )}
            <button 
              onClick={() => onRefresh()} 
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent/20 bg-accent/5 hover:bg-accent/15 text-accent text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 animate-in fade-in"
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
              <span>Refresh Analysis</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl p-3 mb-4">
            {error}
          </div>
        )}
        
        <p className="text-[11px] text-muted-foreground font-medium mb-3">
          Refreshing this panel updates the market suggestion only. Executed trades are shown separately in Last Executed Trade.
        </p>

        <div className="relative text-sm leading-relaxed text-muted-foreground p-5 rounded-2xl bg-muted/5 border border-border min-h-[142px]">
          <div className="max-h-[130px] overflow-y-auto pr-1 font-sans">
            {visibleInsight}
          </div>
          {loading && (
            <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] rounded-2xl flex items-center justify-center pointer-events-none">
              <div className="inline-flex items-center gap-2 text-accent text-xs font-bold px-4 py-2.5 rounded-full bg-card border border-accent/25 shadow-lg shadow-accent/10">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Refreshing analysis...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function QuantRuleCard({ dark }: { dark?: boolean }) {
  const rules = [
    { label: "Min confidence", value: "60% to execute" },
    { label: "BUY threshold", value: "≥ 1.5% 24h change" },
    { label: "SELL threshold", value: "< -4% 24h change" },
    { label: "Neutral band", value: "|24h| < 1% ⇒ HOLD" },
    { label: "Trade cap", value: "0.001 OKB max" },
    { label: "Gas buffer", value: "0.001 OKB min extra" },
  ];

  return (
    <GlassCard className="p-6 relative overflow-hidden transition-all duration-300 hover:border-accent/30">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-accent" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Quant Safety Rules
        </h4>
      </div>
      <div className="flex flex-col gap-3">
        {rules.map((rule) => (
          <div
            key={rule.label}
            className="flex justify-between items-center gap-3 pb-2.5 border-b border-border last:border-0 last:pb-0"
          >
            <span className="text-xs text-muted-foreground font-medium">{rule.label}</span>
            <span className="text-xs font-bold font-mono">{rule.value}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function CycleTraceCard({ status, dark }: { status: AgentStatus | null; dark?: boolean }) {
  if (!status || !status.lastRun) {
    return (
      <GlassCard className="p-6">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Cycle Result
        </h4>
        <p className="text-xs text-muted-foreground">Run the agent once to see the latest rule trace.</p>
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
      tone: "text-accent",
      border: "border-accent/10",
      bg: "bg-accent/5",
      icon: <Brain className="w-3.5 h-3.5 text-accent" />
    },
    {
      label: "Confidence gate",
      value: `${status.lastConfidence}% ${confidencePass ? "passed" : "blocked"}`,
      tone: confidencePass ? "text-emerald-500" : "text-destructive",
      border: confidencePass ? "border-emerald-500/10" : "border-destructive/10",
      bg: confidencePass ? "bg-emerald-500/5" : "bg-destructive/5",
      icon: confidencePass ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 text-destructive" />
    },
    {
      label: "Momentum rule",
      value:
        move === null
          ? "Using latest rule output"
          : `${move >= 0 ? "+" : ""}${move.toFixed(2)}% ${movePass ? "qualified" : "held back"}`,
      tone: movePass === null ? "text-muted-foreground" : movePass ? "text-emerald-500" : "text-amber-500",
      border: movePass === null ? "border-border" : movePass ? "border-emerald-500/10" : "border-amber-500/10",
      bg: movePass === null ? "bg-muted/5" : movePass ? "bg-emerald-500/5" : "bg-amber-500/5",
      icon: movePass === null ? <Clock className="w-3.5 h-3.5 text-muted-foreground" /> : movePass ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
    },
    {
      label: "Final result",
      value: status.lastExecution === "executed" ? `${status.lastAction} executed` : `${status.lastAction} skipped`,
      tone: status.lastExecution === "executed" ? "text-emerald-500" : "text-muted-foreground",
      border: status.lastExecution === "executed" ? "border-emerald-500/20" : "border-border",
      bg: status.lastExecution === "executed" ? "bg-emerald-500/5" : "bg-muted/5",
      icon: status.lastExecution === "executed" ? <Zap className="w-3.5 h-3.5 text-emerald-500" /> : <Clock className="w-3.5 h-3.5 text-muted-foreground" />
    },
  ];

  return (
    <GlassCard className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cycle Result</h4>
          <p className="text-[10px] text-muted-foreground mt-0.5">Latest rule trace for the most recent agent cycle</p>
        </div>
        <Badge variant="outline" className="font-bold text-[10px] px-2.5 py-0.5 rounded-full border-accent/20 bg-accent/5 text-accent font-mono">
          #{status.cycleCount}
        </Badge>
      </div>

      <div className="grid gap-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "flex items-center justify-between gap-4 p-3 rounded-xl border",
              row.border,
              row.bg
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {row.icon}
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{row.label}</span>
            </div>
            <div className={cn("text-xs font-bold truncate", row.tone)}>{row.value}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mt-2 p-3 bg-muted/5 border border-border rounded-xl font-medium">
        {status.lastReason || "Rule trace unavailable for this cycle."}
      </p>

      <div className="mt-auto grid grid-cols-3 gap-2.5 pt-4 border-t border-border">
        <div className="p-2.5 rounded-xl bg-muted/5 border border-border text-center">
          <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Execution</div>
          <div className={cn("text-xs font-bold", status.lastExecution === "executed" ? "text-emerald-500" : "text-muted-foreground")}>
            {status.lastExecution === "executed" ? "Executed" : "Skipped"}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/5 border border-border text-center">
          <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Tx Hash</div>
          <div className="text-xs font-bold font-mono truncate">
            {status.lastTxHash ? (
              <a href={txUrl(status.lastTxHash)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {shortHash(status.lastTxHash)}
              </a>
            ) : (
              "No tx"
            )}
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-muted/5 border border-border text-center">
          <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mb-1">Updated</div>
          <div className="text-xs font-bold font-mono">
            {new Date(status.lastRun).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function TimelinePanel({ events, dark }: { events: TimelineEvent[]; dark?: boolean }) {
  return (
    <GlassCard className="p-6 flex flex-col min-h-[250px]">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
        AI Reasoning Timeline
      </h4>
      <div className="max-h-[210px] overflow-y-auto pr-1 flex flex-col gap-2 relative">
        {events.length === 0 && (
          <div className="text-xs text-muted-foreground py-10 text-center font-medium">
            Waiting for agent cycle...
          </div>
        )}
        {events.map((ev, i) => {
          const isLatest = i === 0;
          let icon = <Info className="w-3 h-3 text-muted-foreground" />;
          let iconBg = "bg-muted/10 border-border";
          let textColor = "text-muted-foreground";

          if (ev.type === "confirm") {
            icon = <CheckCircle2 className="w-3 h-3 text-emerald-500" />;
            iconBg = "bg-emerald-500/10 border-emerald-500/20";
            textColor = isLatest ? "text-emerald-500 font-bold" : "text-muted-foreground";
          } else if (ev.type === "trade") {
            icon = <Zap className="w-3 h-3 text-indigo-500" />;
            iconBg = "bg-indigo-500/10 border-indigo-500/20";
            textColor = isLatest ? "text-indigo-500 font-bold" : "text-muted-foreground";
          } else if (ev.type === "decision") {
            icon = <Activity className="w-3 h-3 text-accent" />;
            iconBg = "bg-accent/10 border-accent/20";
            textColor = isLatest ? "text-accent font-bold" : "text-muted-foreground";
          }

          return (
            <div 
              key={ev.id} 
              className={cn(
                "flex items-start gap-3 p-2.5 rounded-xl transition-all duration-300 border border-transparent",
                isLatest && "bg-muted/10 border-border animate-in fade-in slide-in-from-top-1 duration-300"
              )}
            >
              <span className="text-[10px] text-muted-foreground font-mono mt-0.5 flex-shrink-0">{ev.time}</span>
              <div className={cn("w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0", iconBg)}>
                {icon}
              </div>
              <span className={cn("text-xs leading-relaxed flex-1", isLatest ? "text-foreground font-semibold" : "text-muted-foreground")}>
                {ev.message}
              </span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function LatestTxMonitor({ tx, dark }: { tx: Transaction | null; dark?: boolean }) {
  if (!tx) return (
    <GlassCard className="p-6">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
        Last Executed Trade
      </h4>
      <div className="text-xs text-muted-foreground py-10 text-center font-medium">
        No transactions yet
      </div>
    </GlassCard>
  );

  return (
    <GlassCard className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PulsingDot />
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Last Executed Trade
            </h4>
            <p className="text-[9px] text-muted-foreground mt-0.5">Latest completed autonomous action</p>
          </div>
        </div>
        <span className="font-bold text-[9px] px-2 py-0.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 flex items-center gap-0.5">
          <CheckCircle2 className="w-2.5 h-2.5" /> CONFIRMED
        </span>
      </div>

      <div className="p-4 rounded-xl border border-accent/10 bg-accent/5 shadow-sm shadow-accent/5">
        <div className="text-sm font-extrabold flex items-center gap-1.5 mb-2 flex-wrap">
          <span>{tx.type}</span>
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground">{tx.from}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
          <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">{tx.to}</span>
        </div>
        <div className="text-xs text-muted-foreground mb-3 font-semibold">
          amount: <span className="text-foreground font-bold font-mono">{tx.amount}</span>
        </div>
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <a 
              href={txUrl(tx.hash)} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs font-bold text-accent hover:underline font-mono inline-flex items-center gap-1"
            >
              tx: {shortHash(tx.hash)} <ExternalLink className="w-3 h-3" />
            </a>
            <CopyButton text={tx.hash.replace(/\.\.\./g, "")} />
          </div>
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-1">
            <Clock className="w-3 h-3" /> {tx.timeAgo}
          </span>
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
  dark?: boolean;
  changeText: string;
}) {
  if (!active || !payload?.length) return null;
  const isUp = !changeText.startsWith("-");

  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-xl shadow-background/50 min-w-[140px] backdrop-blur-md">
      <div className="text-[10px] text-muted-foreground font-medium mb-1">{label}</div>
      <div className="text-sm font-extrabold font-mono text-foreground">{formatPriceLabel(payload[0].value)}</div>
      <div className={cn("text-[10px] font-bold mt-1.5 flex items-center gap-0.5", isUp ? "text-emerald-500" : "text-destructive")}>
        {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
        <span>{changeText} today</span>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function XpulseDashboard() {
  const [dark, setDark]                     = useState(false);
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
  const [showGuide, setShowGuide]           = useState(false);
  const nextId                              = useRef(1);
  const prevStatusRef                       = useRef<AgentStatus | null>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem("xpulse-guide-dismissed");
    if (!dismissed) {
      setShowGuide(true);
    }
  }, []);

  const handleDismissGuide = () => {
    localStorage.setItem("xpulse-guide-dismissed", "true");
    setShowGuide(false);
  };

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
      const isDark = saved === "dark";
      setDark(isDark);
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    } else {
      setDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("xpulse-theme", dark ? "dark" : "light");
      if (dark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [dark, mounted]);

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
    const coinSymbol = activeTab;
    const coinId = COIN_IDS[coinSymbol] ?? COIN_IDS.btc;
    try {
      const res = await fetch(`/api/chart?coin=${coinId}`, { cache: "no-store" });
      const data = await res.json() as ChartResponse;
      if (!res.ok) {
        throw new Error(data.error || `Chart request failed with status ${res.status}`);
      }
      if (Array.isArray(data.chart) && data.chart.length > 0) {
        setChartData(data.chart);
        setChartUpdatedAt(Date.now());
      } else {
        throw new Error("Empty chart data");
      }
    } catch {
      const coinMeta = marketData.find((coin) => coin.symbol === coinSymbol);
      if (coinMeta) {
        const fallbackData = generateFallbackChart(coinMeta.current_price, coinMeta.price_change_percentage_24h);
        setChartData(fallbackData);
        setChartUpdatedAt(Date.now());
      } else {
        const staticCoin = FALLBACK_MARKET.find((coin) => coin.symbol === coinSymbol) ?? FALLBACK_MARKET[0];
        const fallbackData = generateFallbackChart(staticCoin.current_price, staticCoin.price_change_percentage_24h);
        setChartData(fallbackData);
        setChartUpdatedAt(Date.now());
      }
    } finally {
      setChartLoading(false);
    }
  }, [activeTab, marketData]);

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
      const payload = (Array.isArray(snapshot) && snapshot.length > 0) ? snapshot : marketData;
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
  const isLoadingStats = marketData.length === 0;
  const topGainer    = [...marketData]
    .filter((coin) => coin.price_change_percentage_24h >= 0)
    .sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h)[0];
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
  const selectedCoin = marketData.find((coin) => coin.symbol === activeTab) ?? marketData[0];
  const latestChartPoint = chartData[chartData.length - 1] ?? null;
  const chartTrendUp = (selectedCoin?.price_change_percentage_24h ?? 0) >= 0;
  const chartDeltaText = `${chartTrendUp ? "+" : ""}${(selectedCoin?.price_change_percentage_24h ?? 0).toFixed(2)}%`;
  const chartRangeText = selectedCoin ? `${formatPriceLabel(selectedCoin.current_price * 0.985)} - ${formatPriceLabel(selectedCoin.current_price * 1.015)}` : "Waiting for range";

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300 overflow-x-hidden pb-12 selection:bg-accent/20">
      <style>{`
        @keyframes ping { 75%,100%{transform:scale(2);opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:none} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:none} }
        * { box-sizing:border-box; margin:0; padding:0; }
        html { scroll-behavior: smooth; }
      `}</style>

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border shadow-sm px-4 py-3 md:px-8 lg:px-12">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3.5">
          {/* Top bar on mobile / Left side on desktop */}
          <div className="flex items-center justify-between md:justify-start gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shadow-sm dark:shadow-md transition-transform duration-300 hover:scale-105">
                <svg className="w-5 h-5 text-zinc-900 dark:text-white" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <g transform="translate(51, 106)">
                    <path d="M 15,0 L 75,0 A 15,15 0 0 1 90,15 L 90,60 C 90,80 120,105 150,105 C 180,105 210,80 210,60 L 210,15 A 15,15 0 0 1 225,0 L 285,0 A 15,15 0 0 1 300,15 L 300,75 A 15,15 0 0 1 285,90 L 240,90 C 215,90 195,120 195,150 C 195,180 215,210 240,210 L 285,210 A 15,15 0 0 1 300,225 L 300,285 A 15,15 0 0 1 285,300 L 225,300 A 15,15 0 0 1 210,285 L 210,240 C 210,215 180,195 150,195 C 120,195 90,215 90,240 L 90,285 A 15,15 0 0 1 75,300 L 15,300 A 15,15 0 0 1 0,285 L 0,225 A 15,15 0 0 1 15,210 L 60,210 C 85,210 105,180 105,150 C 105,120 85,90 60,90 L 15,90 A 15,15 0 0 1 0,75 L 0,15 A 15,15 0 0 1 15,0 Z" fill="currentColor" />
                    <rect x="330" y="0" width="80" height="300" rx="20" fill="currentColor" />
                  </g>
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-extrabold tracking-tight">Xpulse AI</h1>
                <p className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mt-0.5">
                  Autonomous · X Layer
                </p>
              </div>
            </div>
            
            {/* Mobile-only action buttons (Run & Theme) */}
            <div className="flex items-center gap-1.5 md:hidden">
              <button
                onClick={runAgent}
                disabled={agentRunning}
                className={cn(
                  "inline-flex items-center justify-center p-2 rounded-xl text-white shadow-md transition-all hover:scale-105 active:scale-95 disabled:opacity-50",
                  agentRunning ? "bg-muted text-muted-foreground" : "bg-gradient-to-r from-accent to-indigo-600"
                )}
                title="Run Agent"
              >
                <Zap className={cn("w-4 h-4", agentRunning && "animate-pulse")} />
              </button>
              <button 
                onClick={() => setDark(d => !d)} 
                className="inline-flex items-center justify-center p-2 rounded-xl border border-border bg-card text-foreground transition-all hover:bg-muted/50 active:scale-95"
                title="Toggle Theme"
              >
                {dark ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Badges - Scrollable on mobile, wrapped on desktop */}
          <div className="flex items-center gap-2 overflow-x-auto flex-nowrap md:flex-wrap md:justify-center scrollbar-none pb-0.5 max-w-full">
            <Tooltip>
              <TooltipTrigger>
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 font-semibold text-[10px] border-accent/20 bg-accent/5 text-accent flex items-center gap-1 cursor-help">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  X Layer Mainnet
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="bg-popover text-popover-foreground border border-border rounded-lg p-2 text-xs shadow-md">
                Chain ID 196 (OKX Layer 2)
              </TooltipContent>
            </Tooltip>

            <Badge variant="outline" className="rounded-full px-2.5 py-0.5 font-semibold text-[10px] border-indigo-500/20 bg-indigo-500/5 text-indigo-500 flex items-center gap-0.5">
               <Shield className="w-3 h-3" /> Onchain OS
            </Badge>

            {agentStatus ? (
              <Badge variant="outline" className="rounded-full px-2.5 py-0.5 font-medium text-[10px] border-border bg-card text-muted-foreground font-mono">
                {agentStatus.cycleCount} cycles
              </Badge>
            ) : (
              <Badge variant="outline" className="rounded-full px-2.5 py-0.5 font-medium text-[10px] border-border bg-card text-muted-foreground/50 font-mono flex items-center gap-1">
                <RefreshCw className="w-2.5 h-2.5 animate-spin text-accent" />
                <span>loading cycles</span>
              </Badge>
            )}
          </div>

          {/* Right: Desktop actions / Mobile status pill */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Status Indicator */}
            <div className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-all duration-300 w-full sm:w-auto",
              isActive ? "bg-emerald-500/5 border-emerald-500/10 shadow-sm shadow-emerald-500/5" : "bg-amber-500/5 border-amber-500/10"
            )}>
              {isActive ? <PulsingDot /> : <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />}
              <div className="flex-1 min-w-0">
                <div className={cn("text-[9px] font-bold tracking-wider uppercase leading-none", isActive ? "text-emerald-500" : "text-amber-500")}>
                  {isActive ? "AGENT ACTIVE" : "AGENT IDLE"}
                </div>
                <div className="text-[8px] text-muted-foreground font-semibold mt-0.5 leading-none">
                  Last: {lastTradeAgo}
                </div>
              </div>
            </div>

            {/* Desktop-only action buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={runAgent}
                disabled={agentRunning}
                className={cn(
                  "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs text-white shadow-lg transition-all duration-300 hover:scale-[1.02] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:scale-100 disabled:shadow-none",
                  agentRunning ? "bg-muted border border-border text-muted-foreground" : "bg-gradient-to-r from-accent to-indigo-600 shadow-accent/15"
                )}
              >
                <Zap className={cn("w-3.5 h-3.5", agentRunning && "animate-pulse")} />
                <span>{agentRunning ? "Running..." : "Run Agent"}</span>
              </button>
              <button 
                onClick={() => setDark(d => !d)} 
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-border bg-card hover:bg-muted/30 text-foreground text-xs font-bold shadow-sm transition-all duration-300 active:scale-[0.98]"
              >
                {dark ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5" />}
                <span>{dark ? "Light" : "Dark"}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 md:px-8 lg:px-12 max-w-[1440px] mx-auto space-y-6 md:space-y-8 animate-in fade-in duration-500">

        {/* Welcome Guide for beginners (Stateful & Dismissible) */}
        {showGuide && (
          <GlassCard className="relative overflow-hidden p-5 md:p-6 border-accent/20 bg-accent/5 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-accent via-purple to-indigo-500" />
            <button 
              onClick={handleDismissGuide}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Hide user guide"
            >
              <XCircle className="w-4 h-4" />
            </button>
            
            <div className="flex gap-4 items-start pr-6">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent flex-shrink-0">
                <Brain className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-2">
                <h2 className="text-base font-extrabold tracking-tight">Welcome to Xpulse AI 🤖</h2>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl font-medium">
                  Xpulse AI is an autonomous agent that monitors the OKX <strong>X Layer</strong>, generates market insights using Groq LLaMA 3.3, and executes onchain trades. Here is a quick guide to help you get started:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4.5 pt-3">
                  <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm hover:border-accent/10 transition-colors">
                    <div className="text-[10px] text-accent font-extrabold uppercase tracking-wider mb-1">1. AI Suggestion</div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      The agent scans the markets to identify trading opportunities and updates the live analysis report.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm hover:border-indigo-500/10 transition-colors">
                    <div className="text-[10px] text-indigo-500 font-extrabold uppercase tracking-wider mb-1">2. Safety Rules</div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Before placing trades, the agent validates confidence scores and price momentum triggers to manage risk.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-border bg-card shadow-sm hover:border-emerald-500/10 transition-colors">
                    <div className="text-[10px] text-emerald-500 font-extrabold uppercase tracking-wider mb-1">3. Onchain Execution</div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      When gates pass, it swaps assets (OKB/WOKB) autonomously. Follow executed steps in the Cycle Result trace.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        )}

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <StatCard
            label="Total Market Cap"
            value={formattedMarketCap}
            delta={formattedMarketCapDelta}
            neg={totalMarketCapDelta < 0}
            loading={isLoadingStats}
            className="col-span-2 lg:col-span-1"
          />
          <StatCard
            label="Top Gainer"
            value={topGainer?.symbol.toUpperCase() ?? "—"}
            delta={topGainer ? `+${topGainer.price_change_percentage_24h.toFixed(2)}%` : "—"}
            neg={topGainer ? false : undefined}
            loading={isLoadingStats}
            className="col-span-1 lg:col-span-1"
          />
          <StatCard
            label="Top Loser"
            value={topLoser?.symbol.toUpperCase() ?? "—"}
            delta={topLoser ? `${topLoser.price_change_percentage_24h.toFixed(2)}%` : "—"}
            neg={topLoser ? true : undefined}
            loading={isLoadingStats}
            className="col-span-1 lg:col-span-1"
          />
          {/* Agent Portfolio card */}
          <GlassCard className="p-6 transition-all duration-300 hover:border-accent/30 flex flex-col justify-between col-span-2 lg:col-span-1">
            <div>
              <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">Agent Portfolio</div>
              <div className="text-[10px] text-muted-foreground font-medium mb-3 flex items-center gap-1">
                <Clock className="w-3 h-3 text-emerald-500" />
                <span>{formatUpdatedAt(portfolioUpdatedAt)}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-semibold">OKB</span>
                  <span className="text-xs font-bold font-mono">
                    {portfolio.okb.toFixed(4)}
                    <span className="text-[10px] text-muted-foreground font-medium ml-1">(${portfolio.okbUsd.toFixed(2)})</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground font-semibold">WOKB</span>
                  <span className="text-xs font-bold font-mono">
                    {portfolio.wokb.toFixed(4)}
                    <span className="text-[10px] text-muted-foreground font-medium ml-1">(${portfolio.wokbUsd.toFixed(2)})</span>
                  </span>
                </div>
              </div>
            </div>
            <div className="border-t border-border mt-4 pt-3.5 flex justify-between items-center">
              <span className="text-xs text-muted-foreground font-semibold">Total Value</span>
              <span className="text-base font-extrabold text-emerald-500 font-mono">${portfolio.totalUsd.toFixed(2)}</span>
            </div>
          </GlassCard>
        </div>

        {/* ── AI Insight + Latest TX ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] items-start gap-6">
          <div className="flex flex-col gap-6">
            <AIInsightPanel insight={insight} loading={insightLoading} error={insightError} updatedAt={insightUpdatedAt} onRefresh={fetchInsight} />
            <CycleTraceCard status={agentStatus} />
          </div>
          <div className="flex flex-col gap-6">
            <TimelinePanel events={timeline} />
            <QuantRuleCard />
            <LatestTxMonitor tx={latestTx} />
          </div>
        </div>

        {/* ── Market + Chart + Timeline ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          <GlassCard className="p-6 flex flex-col gap-4">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Market Movers</h4>
              <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{formatUpdatedAt(marketUpdatedAt)}</p>
            </div>
            <div className="flex flex-col gap-2.5">
              {marketData.map(c => <MarketMoverCard key={c.id} coin={c} />)}
            </div>
          </GlassCard>

          <GlassCard className="p-6 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h4 className="text-sm font-bold text-foreground">Price Chart</h4>
                  {selectedCoin && (
                    <Badge variant="outline" className={cn(
                      "font-bold text-[10px] px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm",
                      chartTrendUp ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-destructive/20 bg-destructive/10 text-destructive"
                    )}>
                      {chartTrendUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      <span>{selectedCoin.symbol.toUpperCase()} {chartDeltaText}</span>
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground font-medium min-h-[15px] flex items-center">
                  {chartLoading ? (
                    <span className="flex items-center gap-1.5 text-accent animate-pulse">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Refreshing data...</span>
                    </span>
                  ) : (
                    <span>{formatUpdatedAt(chartUpdatedAt)}</span>
                  )}
                </div>
                <div className="flex items-center gap-6 flex-wrap mt-3">
                  <div>
                    <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Latest Price</span>
                    <div className="text-2xl font-extrabold tracking-tight font-mono mt-0.5">
                      {formatPriceLabel(latestChartPoint?.price ?? selectedCoin?.current_price ?? 0)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">24H Trading Range</span>
                    <div className="text-xs font-bold font-mono text-muted-foreground mt-1.5">
                      {chartRangeText}
                    </div>
                  </div>
                </div>
              </div>
              
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-fit">
                <TabsList className="bg-muted p-[3px] rounded-lg flex flex-wrap gap-1 border border-border/50">
                  {["btc", "eth", "sol", "link", "okb"].map(tab => (
                    <TabsTrigger
                      key={tab}
                      value={tab}
                      className="px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all data-[active]:!bg-background data-[active]:!text-accent data-[active]:!shadow-sm border border-transparent"
                    >
                      {tab.toUpperCase()}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            
            {/* Calculate dynamic chart Y-axis domain */}
            {(() => {
              const prices = chartData.map((d) => d.price);
              const minPrice = prices.length > 0 ? Math.min(...prices) : (selectedCoin?.current_price ?? 100) * 0.95;
              const maxPrice = prices.length > 0 ? Math.max(...prices) : (selectedCoin?.current_price ?? 100) * 1.05;
              const priceRange = maxPrice - minPrice;
              const padding = priceRange > 0 ? priceRange * 0.15 : (minPrice * 0.02);
              const domainMin = Math.max(0, minPrice - padding);
              const domainMax = maxPrice + padding;

              return (
                <div className="w-full h-[260px] mt-4 font-mono text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={68} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(2)}`} domain={[domainMin, domainMax]} />
                      <RechartsTooltip content={<ChartTooltipCard dark={dark} changeText={chartDeltaText} />} cursor={{ stroke: "var(--accent)", strokeOpacity: 0.18, strokeDasharray: "4 4" }} />
                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="var(--accent)"
                        strokeWidth={2.5}
                        fill="url(#cg)"
                        dot={false}
                        activeDot={{ r: 4.5, stroke: "var(--accent)", strokeWidth: 1.5, fill: "var(--card)" }}
                        animationDuration={600}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              );
            })()}
          </GlassCard>
        </div>

        {/* ── Transaction Feed ── */}
        <div className="animate-in fade-in duration-500 delay-150">
          <GlassCard className="overflow-hidden p-0">
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h4 className="text-sm font-bold text-foreground">Onchain Activity</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Transactions executed by the AI agent via okx-agentic-wallet on X Layer Mainnet
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-medium">auto-refresh 5s</span>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
            </div>
            
            <ShadcnTable className="w-full">
              <ShadcnTableHeader className="bg-muted/10">
                <ShadcnTableRow className="hover:bg-transparent border-b border-border">
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider pl-6 text-muted-foreground h-10">TX Hash</ShadcnTableHead>
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground h-10 hidden md:table-cell">Skill</ShadcnTableHead>
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground h-10 hidden md:table-cell">Route</ShadcnTableHead>
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground h-10 hidden md:table-cell">Amount</ShadcnTableHead>
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider text-muted-foreground h-10">Status</ShadcnTableHead>
                  <ShadcnTableHead className="font-bold text-[10px] uppercase tracking-wider pr-6 text-muted-foreground h-10 hidden md:table-cell">Time</ShadcnTableHead>
                </ShadcnTableRow>
              </ShadcnTableHeader>
              <ShadcnTableBody>
                {transactions.length === 0 ? (
                  <ShadcnTableRow>
                    <ShadcnTableCell colSpan={6} className="text-center py-12 text-xs text-muted-foreground font-medium">
                      No transactions yet. Run the agent to see real onchain activity.
                    </ShadcnTableCell>
                  </ShadcnTableRow>
                ) : (
                  transactions.map((tx, i) => {
                    const statusColor = tx.status === "confirmed" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : "border-amber-500/20 bg-amber-500/10 text-amber-500";
                    const isLatest = i === 0;

                    return (
                      <ShadcnTableRow
                        key={tx.hash}
                        className={cn(
                          "transition-colors border-b border-border",
                          isLatest ? "bg-accent/[0.03] hover:bg-accent/[0.05]" : "hover:bg-muted/10"
                        )}
                      >
                        <ShadcnTableCell className="py-4 pl-6">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <a
                                href={txUrl(tx.hash)} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs font-bold text-accent hover:underline font-mono inline-flex items-center gap-1"
                              >
                                {shortHash(tx.hash)} <ExternalLink className="w-3 h-3" />
                              </a>
                              <CopyButton text={tx.hash.replace(/\.\.\./g, "")} />
                            </div>
                            {/* Inline display on mobile layout */}
                            <div className="flex flex-col gap-0.5 md:hidden">
                              <span className="text-[10px] font-mono text-muted-foreground">{tx.from} → {tx.to}</span>
                              <span className="text-[10px] text-muted-foreground font-medium">{tx.amount} • {tx.timeAgo}</span>
                            </div>
                          </div>
                        </ShadcnTableCell>
                        <ShadcnTableCell className="py-4 hidden md:table-cell">
                          <Badge variant="outline" className="font-bold text-[9px] px-2 py-0.5 rounded-md border-indigo-500/15 bg-indigo-500/5 text-indigo-500">
                            {tx.type}
                          </Badge>
                        </ShadcnTableCell>
                        <ShadcnTableCell className="py-4 font-mono text-xs text-muted-foreground hidden md:table-cell">
                          {tx.from} → {tx.to}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="py-4 font-bold font-mono text-xs hidden md:table-cell">
                          {tx.amount}
                        </ShadcnTableCell>
                        <ShadcnTableCell className="py-4">
                          <Badge variant="outline" className={cn("font-bold text-[9px] px-2 py-0.5 rounded-md", statusColor)}>
                            {tx.status}
                          </Badge>
                        </ShadcnTableCell>
                        <ShadcnTableCell className="py-4 pr-6 text-xs text-muted-foreground hidden md:table-cell">
                          {tx.timeAgo}
                        </ShadcnTableCell>
                      </ShadcnTableRow>
                    );
                  })
                )}
              </ShadcnTableBody>
            </ShadcnTable>
          </GlassCard>
        </div>

        {/* ── Footer with Wallet Address ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 items-center gap-6 pt-6 border-t border-border mt-12 pb-6">
          {/* Agent wallet */}
          <div className="w-full flex justify-center lg:justify-start">
            <GlassCard className="p-4 flex flex-col sm:flex-row items-center gap-4 border border-border w-full sm:w-auto">
              <div>
                <div className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mb-1">
                  Agent Wallet Address
                </div>
                <div className="text-xs font-bold font-mono flex items-center gap-1.5 justify-center lg:justify-start">
                  <span>{shortAddr(walletAddr)}</span>
                  <CopyButton text={walletAddr} />
                </div>
              </div>
              <a
                href={walletUrl(walletAddr)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-accent bg-accent/5 border border-accent/20 hover:bg-accent/15 px-4 py-2.5 rounded-xl text-center inline-flex items-center justify-center gap-1.5 transition-all duration-300 hover:scale-[1.02] w-full sm:w-auto"
              >
                <span>View Wallet</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </GlassCard>
          </div>

          {/* Footer credit */}
          <div className="flex justify-center">
            <a
              href="https://x.com/Ritesh5969"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 group text-decoration-none"
            >
              <img
                src="https://pbs.twimg.com/profile_images/1944572785373728768/Qc4iOnla_400x400.jpg"
                alt="Ritesh5969"
                className="w-10 h-10 rounded-full object-cover border border-border shadow-sm group-hover:scale-105 transition-all duration-300 ring-2 ring-border group-hover:ring-accent/50"
              />
              <div>
                <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Developer</p>
                <p className="text-xs font-semibold group-hover:text-accent transition-colors">
                  Built by <span className="font-bold text-accent">Ritesh5969</span>
                </p>
              </div>
            </a>
          </div>

          {/* Last refresh indicator */}
          <div className="w-full flex flex-col items-center lg:items-end text-center lg:text-right text-[10px] text-muted-foreground font-medium space-y-1">
            <p className="flex items-center justify-center lg:justify-end gap-1">
              <Clock className="w-3 h-3 text-emerald-500 animate-pulse" />
              <span>Refreshes automatically every 5s</span>
            </p>
            {agentStatus?.lastRun ? (
              <p>Last agent run: {agentStatus.lastRunAgo}</p>
            ) : null}
            <button 
              onClick={() => { localStorage.removeItem("xpulse-guide-dismissed"); setShowGuide(true); }}
              className="text-[9px] text-accent hover:underline font-bold mt-1.5 transition-all active:scale-95"
            >
              Show Welcome Guide
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
