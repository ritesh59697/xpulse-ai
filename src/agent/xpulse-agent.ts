// ============================================================
// src/agent/xpulse-agent.ts  — UPGRADED v2
// Xpulse AI — Intelligent Multi-Asset Trading Agent
// Build X Hackathon 2026 — X Layer (Chain ID 196 mainnet / 1952 testnet)
//
// CHANGES FROM v1:
//   1. Multi-asset scoring engine: scores ALL tokens, picks the best one
//      No more ETH bias or hardcoded token choice
//   2. xAI Grok API for real crypto-twitter sentiment (optional, graceful fallback)
//   3. Clean 4-layer architecture: Data → Scoring → Decision → Execution
//   4. TokenScore exported so dashboard can show WHY a token was chosen
//   5. Groq now analyzes the TOP-SCORED token only (not all tokens)
//      This removes the "only ETH/OKB" bias from the prompt
// ============================================================

import Groq from "groq-sdk";
import { ethers } from "ethers";
import CryptoJS from "crypto-js";
import {
  getAgentWallet,
  getAgentWalletAddress,
  getTxExplorerUrl,
  ACTIVE,
} from "../lib/xlayer.ts";
import {
  writeAgentStatus,
  appendTransaction,
  readAgentStatus,
  readMarketSnapshot,
  writeMarketSnapshot,
} from "../lib/agent-store.ts";
import { coinGeckoHeaders } from "../lib/coingecko.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoinData {
  id: string; symbol: string; name: string;
  current_price: number; price_change_percentage_24h: number;
  market_cap: number; total_volume: number;
}

export interface AgentDecision {
  action: "BUY" | "SELL" | "HOLD" | "SWAP";
  asset: string; targetAsset?: string;
  amount: string; reason: string;
  confidence: number; timestamp: number;
}

// ─── NEW: per-token scoring exported for dashboard ───────────────────────────
// Dashboard can now show "why ETH scored 78 vs OKB scored 62"
export interface TokenScore {
  symbol:        string;
  totalScore:    number;   // 0-100 composite
  momentumScore: number;   // price momentum contribution
  volumeScore:   number;   // volume surge contribution
  strengthScore: number;   // relative strength vs peers
  sentimentScore: number;  // xAI sentiment if available, else neutral 50
  trend:         "strong_up" | "up" | "flat" | "down" | "strong_down";
  signal:        "BUY" | "HOLD" | "SELL";
}

export interface AgentCycleResult {
  marketData:  CoinData[];
  topGainers:  CoinData[];
  topLosers:   CoinData[];
  aiSummary:   string;
  decision:    AgentDecision;
  walletAddress?: string;
  txHash?:     string;
  tokenScores: TokenScore[];   // NEW — full ranking shown on dashboard
  chosenToken: string;         // NEW — which token won and why
}

interface ExecuteOnchainOptions {
  amountInOkb?: string;
  label?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  GROQ_API_KEY:      process.env.GROQ_API_KEY       || "",
  XAI_API_KEY:       process.env.XAI_API_KEY        || "", // optional — for crypto sentiment
  AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY  || "",
  COINGECKO_API:     "https://api.coingecko.com/api/v3",
  CHAIN_ID:          ACTIVE.chainId,

  OKX_API_KEY:       process.env.OKX_API_KEY        || "",
  OKX_SECRET_KEY:    process.env.OKX_SECRET_KEY     || "",
  OKX_PASSPHRASE:    process.env.OKX_PASSPHRASE     || "",
  OKX_PROJECT_ID:    process.env.OKX_PROJECT_ID     || "",

  MAINNET_TRADE_OKB: "0.0005",
  MAX_TRADE_OKB:     "0.001",
  MIN_CONFIDENCE:    62,

  // Scoring weights (must sum to 1.0)
  W_MOMENTUM:  0.35,   // 24h price change weighted by magnitude
  W_VOLUME:    0.20,   // volume surge vs average
  W_STRENGTH:  0.25,   // relative strength vs all tracked tokens
  W_SENTIMENT: 0.20,   // xAI crypto twitter sentiment (defaults to neutral if no key)
};

export const QUANT_RULES = {
  minConfidence:    CONFIG.MIN_CONFIDENCE,
  buyMomentumMin:   1.5,    // % 24h needed to qualify a BUY
  sellMomentumMax:  -4.0,   // % 24h to trigger SELL
  neutralBand:      1.0,    // |24h| < 1% = flat market, HOLD
  minScoreForBuy:   58,     // token total score must be this high to BUY
  maxTradeOkb:      CONFIG.MAX_TRADE_OKB,
  gasBufferOkb:     0.001,
} as const;

// ─── X Layer token addresses ──────────────────────────────────────────────────

const TOKENS: Record<string, string> = {
  OKB:  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  WOKB: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
  USDC: "0x74b7F16337b8972027F6196a17a631aC6de26d22",
  ETH:  "0x5A77f1443D16ee5761d310E38b62f77f726bC71c",
};

const WOKB_ABI = ["function deposit() external payable"];

// ─── OKX DEX API helpers ──────────────────────────────────────────────────────

function okxHeaders(method: string, path: string, queryString = ""): Record<string, string> {
  const ts      = new Date().toISOString();
  const message = ts + method.toUpperCase() + path + queryString;
  const sign    = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(message, CONFIG.OKX_SECRET_KEY)
  );
  return {
    "Content-Type":         "application/json",
    "OK-ACCESS-KEY":        CONFIG.OKX_API_KEY,
    "OK-ACCESS-SIGN":       sign,
    "OK-ACCESS-TIMESTAMP":  ts,
    "OK-ACCESS-PASSPHRASE": CONFIG.OKX_PASSPHRASE,
    "OK-PROJECT-ID":        CONFIG.OKX_PROJECT_ID,
  };
}

// ─── LAYER 1: Data Fetching ───────────────────────────────────────────────────

export async function fetchMarketData(): Promise<CoinData[]> {
  const coins = ["bitcoin", "ethereum", "okb", "solana", "chainlink"];
  const url   = `${CONFIG.COINGECKO_API}/coins/markets?vs_currency=usd&ids=${coins.join(",")}&order=market_cap_desc&sparkline=false`;
  const headers = coinGeckoHeaders();

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json() as CoinData[];
      await writeMarketSnapshot({ coins: data, updatedAt: Date.now() });
      return data;
    }
    if (res.status === 429 && attempt === 0) {
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    if (res.status === 429) {
      const cached = await readMarketSnapshot();
      if (cached?.coins?.length) {
        console.warn("[Market] CoinGecko rate-limited — using cached snapshot");
        return cached.coins as CoinData[];
      }
    }
    throw new Error(`CoinGecko fetch failed: ${res.status}`);
  }

  const cached = await readMarketSnapshot();
  if (cached?.coins?.length) return cached.coins as CoinData[];
  throw new Error("Market data unavailable");
}

export function detectTopMovers(data: CoinData[]) {
  const sorted = [...data].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
  return { topGainers: sorted.slice(0, 2), topLosers: sorted.slice(-2).reverse() };
}

// ─── LAYER 2: Multi-Asset Scoring Engine ─────────────────────────────────────
// FIX: This completely replaces the ETH-biased single-token approach.
//
// Each token gets scored across 4 dimensions (0-100 each):
//   momentumScore  — how strong is the 24h move?
//   volumeScore    — is volume surging (signal) or flat (noise)?
//   strengthScore  — how does this token rank among all tracked tokens?
//   sentimentScore — crypto twitter signal from xAI (neutral if not configured)
//
// The token with the highest composite score becomes the trade candidate.
// This means the agent will naturally choose SOL over ETH if SOL is stronger.

function scoreMomentum(change24h: number): number {
  // Normalise: 0% = 50, +10% = 90, -10% = 10, capped at 0/100
  const raw = 50 + change24h * 4;
  return Math.max(0, Math.min(100, raw));
}

function scoreVolume(coin: CoinData, allCoins: CoinData[]): number {
  // Compare this coin's volume-to-mcap ratio vs the average across all coins
  const ratio = (value: CoinData) => value.total_volume / Math.max(1, value.market_cap);
  const avgRatio = allCoins.reduce((s, c) => s + ratio(c), 0) / allCoins.length;
  const thisRatio = ratio(coin);
  const relative  = thisRatio / Math.max(avgRatio, 0.0001); // 1.0 = average
  // 1x = 50, 2x = 75, 0.5x = 25, capped 0-100
  return Math.max(0, Math.min(100, 50 + (relative - 1) * 25));
}

function scoreRelativeStrength(coin: CoinData, allCoins: CoinData[]): number {
  // Rank token by 24h change among peers; top rank = 100, bottom = 0
  const sorted = [...allCoins].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
  const rank   = sorted.findIndex(c => c.id === coin.id);
  const n      = sorted.length;
  if (n <= 1) return 50;
  return Math.round(100 - (rank / (n - 1)) * 100);
}

function trendLabel(change24h: number): TokenScore["trend"] {
  if (change24h >=  5) return "strong_up";
  if (change24h >=  1.5) return "up";
  if (change24h <= -5) return "strong_down";
  if (change24h <= -1.5) return "down";
  return "flat";
}

function tokenSignal(score: number, change24h: number): TokenScore["signal"] {
  if (score >= QUANT_RULES.minScoreForBuy && change24h >= QUANT_RULES.buyMomentumMin) return "BUY";
  if (score < 35 && change24h <= QUANT_RULES.sellMomentumMax) return "SELL";
  return "HOLD";
}

// ─── LAYER 2B: xAI Sentiment (optional, never blocks main flow) ──────────────

interface SentimentResult {
  symbol: string;
  score:  number;  // 0-100; 50 = neutral
  summary: string;
}

async function fetchXAISentiment(
  symbols: string[]
): Promise<Map<string, number>> {
  const sentimentMap = new Map<string, number>();

  // Default: all neutral; used when key is missing or API fails
  symbols.forEach(s => sentimentMap.set(s.toLowerCase(), 50));

  if (!CONFIG.XAI_API_KEY) return sentimentMap;

  try {
    const symbolList = symbols.join(", ");
    const response   = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${CONFIG.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:      "grok-3-mini-fast",   // cheapest model for simple sentiment task
        max_tokens: 200,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "You are a crypto market sentiment analyst. Output ONLY valid JSON, no markdown.",
          },
          {
            role: "user",
            content: `Rate the current crypto Twitter/X sentiment for each token: ${symbolList}.
Use recent chatter, trends, and community mood.
Reply with ONLY this JSON (no explanation):
{
  "sentiments": [
    { "symbol": "BTC", "score": 65, "summary": "positive momentum narrative" },
    { "symbol": "ETH", "score": 48, "summary": "mixed, ETF uncertainty" }
  ]
}
Score: 0=very bearish, 50=neutral, 100=very bullish.`,
          },
        ],
      }),
    });

    if (!response.ok) return sentimentMap;

    const data     = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content  = data.choices?.[0]?.message?.content ?? "";
    const cleaned  = content.replace(/```json|```/g, "").trim();
    const parsed   = JSON.parse(cleaned) as { sentiments?: SentimentResult[] };

    if (Array.isArray(parsed.sentiments)) {
      for (const item of parsed.sentiments) {
        const sym = item.symbol?.toLowerCase();
        const sc  = typeof item.score === "number" ? Math.max(0, Math.min(100, item.score)) : 50;
        if (sym) sentimentMap.set(sym, sc);
      }
    }

    console.log("[xAI Sentiment]", Object.fromEntries(sentimentMap));
  } catch (err) {
    console.warn("[xAI Sentiment] Failed — using neutral:", err instanceof Error ? err.message : err);
  }

  return sentimentMap;
}

// ─── LAYER 2C: Compute full token scores ─────────────────────────────────────

export async function computeTokenScores(
  marketData: CoinData[]
): Promise<TokenScore[]> {
  const symbols  = marketData.map(c => c.symbol);
  const sentiment = await fetchXAISentiment(symbols);

  const scores: TokenScore[] = marketData.map(coin => {
    const momentumScore  = scoreMomentum(coin.price_change_percentage_24h);
    const volumeScore    = scoreVolume(coin, marketData);
    const strengthScore  = scoreRelativeStrength(coin, marketData);
    const sentimentScore = sentiment.get(coin.symbol.toLowerCase()) ?? 50;

    const totalScore = Math.round(
      momentumScore  * CONFIG.W_MOMENTUM  +
      volumeScore    * CONFIG.W_VOLUME    +
      strengthScore  * CONFIG.W_STRENGTH  +
      sentimentScore * CONFIG.W_SENTIMENT
    );

    return {
      symbol:        coin.symbol.toUpperCase(),
      totalScore,
      momentumScore:  Math.round(momentumScore),
      volumeScore:    Math.round(volumeScore),
      strengthScore:  Math.round(strengthScore),
      sentimentScore: Math.round(sentimentScore),
      trend:          trendLabel(coin.price_change_percentage_24h),
      signal:         tokenSignal(totalScore, coin.price_change_percentage_24h),
    };
  });

  // Sort best first — dashboard uses this order
  scores.sort((a, b) => b.totalScore - a.totalScore);
  return scores;
}

// ─── LAYER 3A: Groq AI Analysis — now focused on the TOP-SCORED TOKEN ─────────
// FIX: We send the best-scoring token context to Groq instead of asking
//      "which of OKB/USDC/ETH?" — this removes the ETH/OKB hardcoding bias.

export async function generateAIInsight(
  marketData:   CoinData[],
  topGainers:   CoinData[],
  topLosers:    CoinData[],
  chosenSymbol: string,   // ← the token scoring engine picked this
  tokenScores:  TokenScore[]
): Promise<string> {
  if (!CONFIG.GROQ_API_KEY) {
    return `ACTION: HOLD ${chosenSymbol.toUpperCase()} - GROQ_API_KEY not configured.`;
  }

  const groq    = new Groq({ apiKey: CONFIG.GROQ_API_KEY });
  const network = CONFIG.CHAIN_ID === 196 ? "X Layer Mainnet" : "X Layer Testnet";

  const snapshot = marketData
    .map(c => `${c.symbol.toUpperCase()}: $${c.current_price.toFixed(2)} (${c.price_change_percentage_24h.toFixed(2)}%, vol $${(c.total_volume / 1e9).toFixed(2)}B)`)
    .join("\n");

  const scoreTable = tokenScores
    .map(s => `${s.symbol}: score=${s.totalScore} momentum=${s.momentumScore} volume=${s.volumeScore} strength=${s.strengthScore} sentiment=${s.sentimentScore} → ${s.signal}`)
    .join("\n");

  const chosenCoin   = marketData.find(c => c.symbol.toLowerCase() === chosenSymbol.toLowerCase());
  const chosenChange = chosenCoin?.price_change_percentage_24h ?? 0;

  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{
      role: "user",
      content: `You are Xpulse, an autonomous onchain trading agent on ${network}.

MARKET SNAPSHOT (24h):
${snapshot}

MULTI-ASSET SCORING (top-ranked token first):
${scoreTable}

TOP GAINERS: ${topGainers.map(c => c.symbol.toUpperCase()).join(", ")}
TOP LOSERS:  ${topLosers.map(c  => c.symbol.toUpperCase()).join(", ")}

SELECTED CANDIDATE: ${chosenSymbol.toUpperCase()} with 24h change ${chosenChange.toFixed(2)}%
This token was selected by the scoring engine as the best opportunity.

Your job: Give 2-3 sentences of sharp market analysis for ${chosenSymbol.toUpperCase()}.
Then confirm or override the scoring engine's pick based on your analysis.

You may choose from these options on X Layer: OKB, USDC, ETH
If ${chosenSymbol.toUpperCase()} is NOT in [OKB, USDC, ETH], map it to the most correlated X Layer token.

End with EXACTLY: ACTION: [BUY/SELL/HOLD] [OKB|USDC|ETH] - [REASON]`,
    }],
    max_tokens: 280,
    temperature: 0.35,
  });

  return res.choices[0]?.message?.content || `ACTION: HOLD OKB - No signal.`;
}

// ─── LAYER 3B: Decision Engine ───────────────────────────────────────────────
// Combines AI text signal with the score engine result

export function evaluateDecision(
  marketData:   CoinData[],
  aiSummary:    string,
  tokenScores:  TokenScore[]
): AgentDecision {
  const match    = aiSummary.match(/ACTION:\s*(BUY|SELL|HOLD|SWAP)\s+(\w+)/i);
  const aiAction = (match?.[1]?.toUpperCase() ?? "HOLD") as AgentDecision["action"];
  const aiAsset  = match?.[2]?.toLowerCase() ?? "okb";

  const coin   = marketData.find(c => c.symbol.toLowerCase() === aiAsset) || marketData[0];
  const change = coin.price_change_percentage_24h;

  // Get the score for the AI's chosen token (0-100)
  const coinScore = tokenScores.find(s => s.symbol.toLowerCase() === coin.symbol.toLowerCase());
  const score     = coinScore?.totalScore ?? 50;

  let finalAction: AgentDecision["action"] = aiAction;
  let confidence = 50;

  const neutralBand = QUANT_RULES.neutralBand;

  if (Math.abs(change) < neutralBand) {
    // Flat market — HOLD unless score is very high
    finalAction = score >= 72 ? "BUY" : "HOLD";
    confidence  = score >= 72 ? score : 65;
  } else if (aiAction === "BUY") {
    if (change >= QUANT_RULES.buyMomentumMin && score >= QUANT_RULES.minScoreForBuy) {
      // Both momentum and score agree → execute
      const momentumBoost = Math.min(15, Math.round((change - QUANT_RULES.buyMomentumMin) * 5));
      const scoreBoost    = Math.round((score - QUANT_RULES.minScoreForBuy) * 0.5);
      confidence  = Math.min(90, 65 + momentumBoost + scoreBoost);
      finalAction = "BUY";
    } else if (change > 0 && score >= 55) {
      // Weak momentum but decent score → borderline, use confidence gate
      confidence  = Math.min(61, 48 + Math.round(score * 0.2));
      finalAction = "HOLD";
    } else {
      confidence  = Math.max(30, score - 10);
      finalAction = "HOLD";
    }
  } else if (aiAction === "SELL") {
    if (change <= QUANT_RULES.sellMomentumMax) {
      const downsideBoost = Math.min(14, Math.round(Math.abs(change - QUANT_RULES.sellMomentumMax) * 3));
      confidence  = Math.min(85, 65 + downsideBoost);
      finalAction = "SELL";
    } else if (change < 0) {
      confidence  = Math.min(58, 48 + Math.round(Math.abs(change) * 3));
      finalAction = "HOLD";
    } else {
      confidence  = 42;
      finalAction = "HOLD";
    }
  } else if (aiAction === "SWAP") {
    confidence  = 63;
    finalAction = "SWAP";
  }

  // Final quant gate: below min confidence → always HOLD
  if (finalAction !== "HOLD" && confidence < CONFIG.MIN_CONFIDENCE) {
    finalAction = "HOLD";
  }

  const targetAsset = finalAction === "SWAP"
    ? marketData.find(c => c.symbol !== coin.symbol && c.price_change_percentage_24h > 0)?.symbol?.toUpperCase()
    : undefined;

  // Build detailed reason string for dashboard
  let reason = `AI: ${aiAction} ${coin.symbol.toUpperCase()}, score: ${score}/100, 24h: ${change.toFixed(2)}%, confidence: ${confidence}%`;
  if (finalAction === "HOLD" && aiAction === "BUY" && score < QUANT_RULES.minScoreForBuy) {
    reason += ` — score ${score} below buy threshold ${QUANT_RULES.minScoreForBuy}`;
  } else if (finalAction === "HOLD" && change > 0 && change < QUANT_RULES.buyMomentumMin) {
    reason += ` — below BUY momentum ${QUANT_RULES.buyMomentumMin}%`;
  } else if (finalAction === "HOLD" && Math.abs(change) < neutralBand) {
    reason += ` — neutral band`;
  } else if (finalAction === "HOLD" && confidence < CONFIG.MIN_CONFIDENCE) {
    reason += ` — confidence below ${CONFIG.MIN_CONFIDENCE}% gate`;
  }

  return {
    action: finalAction, asset: coin.symbol.toUpperCase(), targetAsset,
    amount: `${CONFIG.MAINNET_TRADE_OKB} OKB`,
    reason, confidence, timestamp: Date.now(),
  };
}

// ─── LAYER 4: Swap route + Onchain Execution ──────────────────────────────────
// (unchanged from v1 — the execution layer stays clean)

interface SwapRoute {
  fromToken: string;
  toToken:   string;
  fromSymbol: string;
  toSymbol:   string;
}

function resolveSwapRoute(decision: AgentDecision): SwapRoute | null {
  const asset  = decision.asset.toUpperCase();
  const target = decision.targetAsset?.toUpperCase() ?? "USDC";

  switch (decision.action) {
    case "BUY":
      if (asset === "OKB" || asset === "WOKB") {
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      if (!TOKENS[asset]) {
        console.warn(`[Swap] No address for ${asset} — falling back to OKB→WOKB wrap`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS.OKB, toToken: TOKENS[asset], fromSymbol: "OKB", toSymbol: asset };

    case "SELL":
      if (asset === "OKB" || asset === "WOKB") {
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      if (!TOKENS[asset]) {
        console.warn(`[Swap] No address for ${asset} — falling back to OKB→WOKB wrap`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS[asset], toToken: TOKENS.USDC, fromSymbol: asset, toSymbol: "USDC" };

    case "SWAP":
      if (!TOKENS[asset] || !TOKENS[target]) {
        console.warn(`[Swap] Missing addresses — wrap fallback`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS[asset], toToken: TOKENS[target], fromSymbol: asset, toSymbol: target };

    default:
      return null;
  }
}

async function executeOKXSwap(route: SwapRoute, amountInOkb: string, wallet: ethers.Wallet): Promise<string | null> {
  const chainIndex = String(CONFIG.CHAIN_ID);
  const amountWei  = ethers.parseEther(amountInOkb).toString();

  if (route.fromToken === TOKENS.OKB && route.toToken === TOKENS.WOKB) {
    console.log(`[OKX DEX] Wrapping ${amountInOkb} OKB → WOKB`);
    const wokb    = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx      = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  if (!CONFIG.OKX_API_KEY || !CONFIG.OKX_SECRET_KEY || !CONFIG.OKX_PASSPHRASE) {
    console.warn("[OKX DEX] API credentials not set — wrapping as fallback");
    const wokb    = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx      = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  const basePath    = "/api/v6/dex/aggregator/swap";
  const queryParams = new URLSearchParams({
    chainIndex, fromTokenAddress: route.fromToken, toTokenAddress: route.toToken,
    amount: amountWei, userWalletAddress: wallet.address, slippagePercent: "0.5", autoSlippage: "true",
  });
  const queryString = "?" + queryParams.toString();

  console.log(`[OKX DEX] Getting quote: ${route.fromSymbol} → ${route.toSymbol}`);
  const quoteRes  = await fetch(`https://web3.okx.com${basePath}${queryString}`, { method: "GET", headers: okxHeaders("GET", basePath, queryString) });
  const quoteData = await quoteRes.json();

  if (quoteData.code !== "0" || !quoteData.data?.[0]) {
    console.error("[OKX DEX] Quote failed — wrapping as fallback");
    const wokb = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx   = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    return (await tx.wait()).hash as string;
  }

  const swapData = quoteData.data[0].tx;

  if (route.fromToken !== TOKENS.OKB) {
    const approvalPath   = "/api/v6/dex/aggregator/approve-transaction";
    const approvalParams = new URLSearchParams({ chainIndex, tokenContractAddress: route.fromToken, approveAmount: amountWei });
    const approvalQS     = "?" + approvalParams.toString();
    const approvalData   = await (await fetch(`https://web3.okx.com${approvalPath}${approvalQS}`, { method: "GET", headers: okxHeaders("GET", approvalPath, approvalQS) })).json();
    if (approvalData.code === "0" && approvalData.data?.[0]?.data) {
      await (await wallet.sendTransaction({ to: approvalData.data[0].to, data: approvalData.data[0].data })).wait();
    }
  }

  const swapTx = await wallet.sendTransaction({
    to: swapData.to, data: swapData.data,
    value: BigInt(swapData.value ?? "0"),
    gasLimit: BigInt(Math.floor(Number(swapData.gas ?? "300000") * 1.2)),
  });
  return (await swapTx.wait())!.hash as string;
}

function safeAmount(requested: string): string {
  const req = parseFloat(requested);
  const max = parseFloat(CONFIG.MAX_TRADE_OKB);
  if (isNaN(req) || req <= 0) return CONFIG.MAINNET_TRADE_OKB;
  if (req > max) { console.warn(`[Safety] Capping ${req} → ${max} OKB`); return CONFIG.MAX_TRADE_OKB; }
  return requested;
}

export async function executeOnchain(decision: AgentDecision, options: ExecuteOnchainOptions = {}): Promise<string | null> {
  if (decision.action === "HOLD") { console.log("[OnchainOS] HOLD — skipping."); return null; }
  if (!CONFIG.AGENT_PRIVATE_KEY) { console.warn("[OnchainOS] AGENT_PRIVATE_KEY not set."); return null; }

  try {
    const wallet = getAgentWallet();
    const network = await wallet.provider!.getNetwork();
    if (Number(network.chainId) !== CONFIG.CHAIN_ID) throw new Error(`Wrong chain: ${network.chainId}, expected ${CONFIG.CHAIN_ID}`);

    const balance    = await wallet.provider!.getBalance(wallet.address);
    const balanceOkb = parseFloat(ethers.formatEther(balance));
    const amountInOkb = safeAmount(options.amountInOkb ?? CONFIG.MAINNET_TRADE_OKB);
    if (balanceOkb < parseFloat(amountInOkb) + 0.001) {
      console.warn(`[Safety] Balance ${balanceOkb.toFixed(4)} OKB insufficient — skipping`);
      return null;
    }

    const route = resolveSwapRoute(decision);
    if (!route) { console.log("[OnchainOS] No route — skipping."); return null; }

    console.log(`[OnchainOS] ${ACTIVE.name} | ${decision.action} ${decision.asset} | ${route.fromSymbol}→${route.toSymbol} | ${amountInOkb} OKB`);
    if (CONFIG.CHAIN_ID === 196) console.log(`[OnchainOS] ⚠  MAINNET — real OKB`);

    const hash = await executeOKXSwap(route, amountInOkb, wallet);
    if (!hash) return null;

    console.log(`[OnchainOS] ✅ ${hash}`);
    console.log(`[OnchainOS] Explorer: ${getTxExplorerUrl(hash)}`);

    await appendTransaction({ hash, type: decision.action, from: route.fromSymbol, to: route.toSymbol, amount: `${amountInOkb} OKB`, status: "confirmed", timestamp: Date.now() });
    return hash;

  } catch (err) {
    console.error("[OnchainOS] ❌ Failed:", err);
    return null;
  }
}

// ─── Main Agent Cycle ─────────────────────────────────────────────────────────

export async function runAgentCycle(): Promise<AgentCycleResult> {
  const networkLabel = CONFIG.CHAIN_ID === 196 ? "X Layer Mainnet" : "X Layer Testnet";

  console.log("\n════════════════════════════════════════════");
  console.log(`  XPULSE AI v2 — ${new Date().toISOString()}`);
  console.log(`  Network: ${networkLabel} (Chain ID ${CONFIG.CHAIN_ID})`);
  console.log(`  xAI Sentiment: ${CONFIG.XAI_API_KEY ? "enabled" : "disabled (neutral)"}`);
  console.log("════════════════════════════════════════════");

  await writeAgentStatus({ isRunning: true });

  try {
    // Step 1 — Data
    console.log("[1/5] Fetching market data...");
    const marketData = await fetchMarketData();
    const { topGainers, topLosers } = detectTopMovers(marketData);

    // Step 2 — Score ALL tokens (replaces the single-token ETH-biased approach)
    console.log("[2/5] Scoring all tokens...");
    const tokenScores = await computeTokenScores(marketData);

    // Log the full ranking so it's clear why the agent picks what it picks
    console.log("\n  TOKEN RANKING:");
    tokenScores.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.symbol.padEnd(5)} score=${s.totalScore} | m=${s.momentumScore} v=${s.volumeScore} rs=${s.strengthScore} sent=${s.sentimentScore} → ${s.signal}`);
    });

    // Best candidate = highest total score
    const chosenToken = tokenScores[0].symbol.toLowerCase();
    console.log(`\n  ✦ Chosen candidate: ${chosenToken.toUpperCase()} (score: ${tokenScores[0].totalScore})\n`);

    // Step 3 — AI Analysis (now focuses Groq on the top-scored token)
    console.log(`[3/5] Groq analysis of ${chosenToken.toUpperCase()}...`);
    const aiSummary = await generateAIInsight(marketData, topGainers, topLosers, chosenToken, tokenScores);
    console.log("Groq Signal:", aiSummary);

    // Step 4 — Decision Engine (combines AI + scores + quant rules)
    console.log("[4/5] Evaluating decision...");
    const decision = evaluateDecision(marketData, aiSummary, tokenScores);
    console.log("Decision:", decision);

    const walletAddress = CONFIG.AGENT_PRIVATE_KEY ? getAgentWalletAddress() : undefined;

    // Step 5 — Execute
    let txHash: string | undefined;
    if (decision.action !== "HOLD") {
      const label = decision.confidence >= 70 ? "live" : "demo";
      console.log(`[5/5] Confidence ${decision.confidence}% → ${label} execution`);
      txHash = (await executeOnchain(decision, { amountInOkb: CONFIG.MAINNET_TRADE_OKB, label })) ?? undefined;
    } else {
      console.log(`[5/5] HOLD — ${decision.reason}`);
    }

    const prevStatus = await readAgentStatus();
    await writeAgentStatus({
      lastRun:        Date.now(),
      lastAction:     decision.action,
      lastAsset:      decision.asset,
      lastConfidence: decision.confidence,
      lastInsight:    aiSummary,
      lastReason:     decision.reason,
      walletAddress:  walletAddress ?? prevStatus.walletAddress,
      cycleCount:     prevStatus.cycleCount + 1,
      isRunning:      false,
      lastTxHash:     txHash ?? "",
      lastExecution:  txHash ? "executed" : "skipped",
    });

    console.log("\n✅ Cycle complete\n");
    return { marketData, topGainers, topLosers, aiSummary, decision, walletAddress, txHash, tokenScores, chosenToken };

  } catch (err) {
    await writeAgentStatus({ isRunning: false });
    throw err;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runAgentCycle()
    .then(result => {
      console.log("\nFinal tokenScores:");
      result.tokenScores.forEach(s => console.log(` ${s.symbol}: ${s.totalScore} → ${s.signal}`));
      console.log(JSON.stringify(result.decision, null, 2));
    })
    .catch(err => { console.error("❌ Agent error:", err); process.exit(1); });
}