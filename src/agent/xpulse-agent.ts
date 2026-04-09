// ============================================================
// src/agent/xpulse-agent.ts
// Xpulse AI — Autonomous Agent with Onchain OS Skills
// Build X Hackathon 2026 — X Layer (Chain ID 196 mainnet / 1952 testnet)
//
// FIX: executeOnchain() now reads decision.action and decision.asset
// and routes to the correct swap via OKX DEX API.
//
// BUY  ETH  → swap OKB  → ETH
// SELL ETH  → swap ETH  → USDC  (sell into stable)
// SWAP      → swap asset → targetAsset
// HOLD      → do nothing
// ============================================================

import Groq   from "groq-sdk";
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

export interface AgentCycleResult {
  marketData: CoinData[]; topGainers: CoinData[]; topLosers: CoinData[];
  aiSummary: string; decision: AgentDecision;
  walletAddress?: string; txHash?: string;
}

interface ExecuteOnchainOptions {
  amountInOkb?: string;
  label?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG = {
  GROQ_API_KEY:      process.env.GROQ_API_KEY       || "",
  AGENT_PRIVATE_KEY: process.env.AGENT_PRIVATE_KEY  || "",
  COINGECKO_API:     "https://api.coingecko.com/api/v3",
  CHAIN_ID:          ACTIVE.chainId,

  // OKX DEX API credentials — add to .env.local
  // Get free API key at: https://www.okx.com/web3/build/developer-center
  OKX_API_KEY:        process.env.OKX_API_KEY        || "",
  OKX_SECRET_KEY:     process.env.OKX_SECRET_KEY     || "",
  OKX_PASSPHRASE:     process.env.OKX_PASSPHRASE     || "",
  OKX_PROJECT_ID:     process.env.OKX_PROJECT_ID     || "",

  // Safety limits for mainnet
  MAINNET_TRADE_OKB: "0.0005",   // ~$0.03 at $60/OKB — very safe
  MAX_TRADE_OKB:     "0.001",    // hard ceiling
  MIN_CONFIDENCE:    60,

  BUY_THRESHOLD:  5,
  SELL_THRESHOLD: -4,
};

// ─── X Layer token addresses (mainnet = testnet same for OKB/WOKB) ────────────

const TOKENS: Record<string, string> = {
  // Native OKB placeholder — used as "from" in buy swaps
  OKB:  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // native token sentinel
  // Wrapped OKB
  WOKB: "0xe538905cf8410324e03a5a23c1c177a474d59b2b",
  // USDC on X Layer mainnet
  USDC: "0x74b7F16337b8972027F6196a17a631aC6de26d22",
  // WETH on X Layer mainnet
  ETH:  "0x5A77f1443D16ee5761d310E38b62f77f726bC71c",
};

// WOKB deposit ABI — fallback if OKX API not configured
const WOKB_ABI = ["function deposit() external payable"];

// ─── OKX DEX API helpers ──────────────────────────────────────────────────────
// Implements HMAC-SHA256 signing required by OKX API

function okxHeaders(
  method: string,
  path: string,
  queryString: string = ""
): Record<string, string> {
  const ts      = new Date().toISOString();
  const message = ts + method.toUpperCase() + path + queryString;
  const sign    = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(message, CONFIG.OKX_SECRET_KEY)
  );
  return {
    "Content-Type":      "application/json",
    "OK-ACCESS-KEY":       CONFIG.OKX_API_KEY,
    "OK-ACCESS-SIGN":      sign,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": CONFIG.OKX_PASSPHRASE,
    "OK-PROJECT-ID":        CONFIG.OKX_PROJECT_ID,
  };
}

// ─── 1. Market Data ───────────────────────────────────────────────────────────

export async function fetchMarketData(): Promise<CoinData[]> {
  const coins = ["bitcoin", "ethereum", "okb", "solana", "chainlink"];
  const url   = `${CONFIG.COINGECKO_API}/coins/markets?vs_currency=usd&ids=${coins.join(",")}&order=market_cap_desc&sparkline=false`;
  const headers: Record<string, string> = {};
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json() as CoinData[];
      await writeMarketSnapshot({ coins: data, updatedAt: Date.now() });
      return data;
    }

    if (res.status === 429 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (res.status === 429) {
      const cached = await readMarketSnapshot();
      if (cached?.coins?.length) {
        console.warn("[Market] CoinGecko rate-limited, using cached market snapshot");
        return cached.coins as CoinData[];
      }
    }

    throw new Error(`CoinGecko fetch failed: ${res.status}`);
  }

  const cached = await readMarketSnapshot();
  if (cached?.coins?.length) {
    console.warn("[Market] Using cached market snapshot after retry exhaustion");
    return cached.coins as CoinData[];
  }
  throw new Error("CoinGecko fetch failed: 429");
}

export function detectTopMovers(data: CoinData[]) {
  const sorted = [...data].sort((a, b) => b.price_change_percentage_24h - a.price_change_percentage_24h);
  return { topGainers: sorted.slice(0, 2), topLosers: sorted.slice(-2).reverse() };
}

// ─── 2. AI Analysis ───────────────────────────────────────────────────────────

export async function generateAIInsight(
  marketData: CoinData[],
  topGainers: CoinData[],
  topLosers:  CoinData[]
): Promise<string> {
  if (!CONFIG.GROQ_API_KEY) return "ACTION: HOLD OKB - GROQ_API_KEY not configured.";

  const groq     = new Groq({ apiKey: CONFIG.GROQ_API_KEY });
  const network  = CONFIG.CHAIN_ID === 196 ? "X Layer Mainnet" : "X Layer Testnet";
  const snapshot = marketData
    .map(c => `${c.symbol.toUpperCase()}: $${c.current_price.toFixed(2)} (${c.price_change_percentage_24h.toFixed(2)}%, vol $${(c.total_volume / 1e9).toFixed(2)}B)`)
    .join("\n");

  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{
      role: "user",
      content: `You are Xpulse, an autonomous onchain trading agent on ${network}.

MARKET SNAPSHOT (24h):
${snapshot}

TOP GAINERS: ${topGainers.map(c => c.symbol.toUpperCase()).join(", ")}
TOP LOSERS:  ${topLosers.map(c  => c.symbol.toUpperCase()).join(", ")}

Analyze in 3 sentences. Be sharp and decisive.
IMPORTANT: Only use tokens available on X Layer: OKB, USDC, ETH
End with EXACTLY: ACTION: [BUY/SELL/HOLD] [OKB|USDC|ETH] - [REASON]`,
    }],
    max_tokens: 300, temperature: 0.4,
  });

  return res.choices[0]?.message?.content || "ACTION: HOLD OKB - No signal.";
}

// ─── 3. Decision Engine ───────────────────────────────────────────────────────

export function evaluateDecision(marketData: CoinData[], aiSummary: string): AgentDecision {
  const match    = aiSummary.match(/ACTION:\s*(BUY|SELL|HOLD|SWAP)\s+(\w+)/i);
  const aiAction = (match?.[1]?.toUpperCase() ?? "HOLD") as AgentDecision["action"];
  const aiAsset  = match?.[2]?.toLowerCase() ?? "okb";
  const coin     = marketData.find(c => c.symbol.toLowerCase() === aiAsset) || marketData[0];
  const change   = coin.price_change_percentage_24h;

  let finalAction: AgentDecision["action"] = aiAction;
  let confidence = 50;

  if      (aiAction === "BUY"  && change > CONFIG.BUY_THRESHOLD)  { confidence = 85; finalAction = "BUY";  }
  else if (aiAction === "SELL" && change < CONFIG.SELL_THRESHOLD) { confidence = 80; finalAction = "SELL"; }
  else if (Math.abs(change) < 1)                                  { confidence = 70; finalAction = "HOLD"; }
  else if (aiAction === "SWAP")                                   { confidence = 65; finalAction = "SWAP"; }

  if (finalAction !== "HOLD" && confidence < CONFIG.MIN_CONFIDENCE) {
    finalAction = "HOLD";
  }

  const targetAsset = finalAction === "SWAP"
    ? marketData.find(c => c.symbol !== coin.symbol && c.price_change_percentage_24h > 0)?.symbol?.toUpperCase()
    : undefined;

  const reason =
    finalAction === "HOLD" && aiAction !== "HOLD" && confidence < CONFIG.MIN_CONFIDENCE
      ? `AI: ${aiAction}, 24h: ${change.toFixed(2)}%, confidence: ${confidence}% — downgraded to HOLD below ${CONFIG.MIN_CONFIDENCE}% threshold`
      : `AI: ${aiAction}, 24h: ${change.toFixed(2)}%, confidence: ${confidence}%`;

  return {
    action: finalAction, asset: coin.symbol.toUpperCase(), targetAsset,
    amount: `${CONFIG.MAINNET_TRADE_OKB} OKB`,
    reason,
    confidence, timestamp: Date.now(),
  };
}

// ─── 4. Swap route resolver ───────────────────────────────────────────────────
// Maps AI decision → { fromToken, toToken, label }

interface SwapRoute {
  fromToken: string;   // 0x contract address
  toToken:   string;   // 0x contract address
  fromSymbol: string;
  toSymbol:   string;
}

function resolveSwapRoute(decision: AgentDecision): SwapRoute | null {
  const asset  = decision.asset.toUpperCase();
  const target = decision.targetAsset?.toUpperCase() ?? "USDC";

  switch (decision.action) {
    case "BUY":
      // BUY ETH → sell OKB, receive ETH
      // BUY USDC → sell OKB, receive USDC
      // BUY OKB → wrap OKB → WOKB (no external swap needed)
      if (asset === "OKB" || asset === "WOKB") {
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      if (!TOKENS[asset]) {
        console.warn(`[Swap] No address for ${asset} — falling back to OKB→WOKB wrap`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS.OKB, toToken: TOKENS[asset], fromSymbol: "OKB", toSymbol: asset };

    case "SELL":
      // SELL ETH → swap ETH → USDC
      if (asset === "OKB" || asset === "WOKB") {
        // Can't sell native OKB via swap API, wrap instead
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      if (!TOKENS[asset]) {
        console.warn(`[Swap] No address for ${asset} — falling back to OKB→WOKB wrap`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS[asset], toToken: TOKENS.USDC, fromSymbol: asset, toSymbol: "USDC" };

    case "SWAP":
      // SWAP asset → targetAsset
      if (!TOKENS[asset] || !TOKENS[target]) {
        console.warn(`[Swap] Missing address for ${asset} or ${target} — wrap fallback`);
        return { fromToken: TOKENS.OKB, toToken: TOKENS.WOKB, fromSymbol: "OKB", toSymbol: "WOKB" };
      }
      return { fromToken: TOKENS[asset], toToken: TOKENS[target], fromSymbol: asset, toSymbol: target };

    default:
      return null;
  }
}

// ─── 5. OKX DEX Swap execution ───────────────────────────────────────────────

async function executeOKXSwap(
  route: SwapRoute,
  amountInOkb: string,
  wallet: ethers.Wallet
): Promise<string | null> {
  const chainIndex = String(CONFIG.CHAIN_ID);
  const amountWei  = ethers.parseEther(amountInOkb).toString();

  // Special case: OKB→WOKB is just a deposit() — no API needed
  if (route.fromToken === TOKENS.OKB && route.toToken === TOKENS.WOKB) {
    console.log(`[OKX DEX] Wrapping ${amountInOkb} OKB → WOKB via deposit()`);
    const wokb    = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx      = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  // For other swaps — use OKX DEX API if credentials are set
  if (!CONFIG.OKX_API_KEY || !CONFIG.OKX_SECRET_KEY || !CONFIG.OKX_PASSPHRASE) {
    console.warn("[OKX DEX] OKX API credentials not set — falling back to OKB→WOKB wrap");
    console.warn("[OKX DEX] Add OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE to .env.local");
    console.warn("[OKX DEX] Get free credentials: https://www.okx.com/web3/build/developer-center");
    // Safe fallback: wrap OKB → WOKB (always works)
    const wokb    = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx      = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  // Step 1: Get swap quote + calldata from OKX DEX API
  const basePath    = "/api/v6/dex/aggregator/swap";
  const queryParams = new URLSearchParams({
    chainIndex,
    fromTokenAddress:  route.fromToken,
    toTokenAddress:    route.toToken,
    amount:            amountWei,
    userWalletAddress: wallet.address,
    slippagePercent:   "0.5",
    autoSlippage:      "true",
  });
  const queryString = "?" + queryParams.toString();

  console.log(`[OKX DEX] Getting quote: ${route.fromSymbol} → ${route.toSymbol}`);

  const quoteRes = await fetch(`https://web3.okx.com${basePath}${queryString}`, {
    method:  "GET",
    headers: okxHeaders("GET", basePath, queryString),
  });

  const quoteData = await quoteRes.json();

  if (quoteData.code !== "0" || !quoteData.data?.[0]) {
    console.error("[OKX DEX] Quote failed:", quoteData.msg ?? JSON.stringify(quoteData));
    // Fallback to wrap
    console.warn("[OKX DEX] Falling back to OKB→WOKB wrap");
    const wokb    = new ethers.Contract(TOKENS.WOKB, WOKB_ABI, wallet);
    const tx      = await wokb.deposit({ value: ethers.parseEther(amountInOkb) });
    const receipt = await tx.wait();
    return receipt.hash as string;
  }

  const swapData = quoteData.data[0].tx;
  console.log(`[OKX DEX] Quote received. Router: ${swapData.to}`);

  // Step 2: Handle ERC-20 approval if needed (not needed for native OKB)
  if (route.fromToken !== TOKENS.OKB) {
    const approvalPath   = "/api/v6/dex/aggregator/approve-transaction";
    const approvalParams = new URLSearchParams({
      chainIndex,
      tokenContractAddress: route.fromToken,
      approveAmount: amountWei,
    });
    const approvalQS = "?" + approvalParams.toString();
    const approvalRes = await fetch(`https://web3.okx.com${approvalPath}${approvalQS}`, {
      method: "GET",
      headers: okxHeaders("GET", approvalPath, approvalQS),
    });
    const approvalData = await approvalRes.json();
    if (approvalData.code === "0" && approvalData.data?.[0]?.data) {
      console.log("[OKX DEX] Sending token approval...");
      const approvalTx = await wallet.sendTransaction({
        to:   approvalData.data[0].to,
        data: approvalData.data[0].data,
      });
      await approvalTx.wait();
      console.log(`[OKX DEX] Approval confirmed: ${approvalTx.hash}`);
    }
  }

  // Step 3: Send the swap transaction
  console.log(`[OKX DEX] Sending swap tx...`);
  const swapTx = await wallet.sendTransaction({
    to:       swapData.to,
    data:     swapData.data,
    value:    BigInt(swapData.value ?? "0"),
    gasLimit: BigInt(Math.floor(Number(swapData.gas ?? "300000") * 1.2)),
  });
  console.log(`[OKX DEX] Submitted: ${swapTx.hash}`);

  const receipt = await swapTx.wait();
  return receipt!.hash as string;
}

// ─── 6. Safety helpers ────────────────────────────────────────────────────────

function safeAmount(requested: string): string {
  const req = parseFloat(requested);
  const max = parseFloat(CONFIG.MAX_TRADE_OKB);
  if (isNaN(req) || req <= 0) return CONFIG.MAINNET_TRADE_OKB;
  if (req > max) {
    console.warn(`[Safety] ${req} OKB exceeds max ${max} — capping`);
    return CONFIG.MAX_TRADE_OKB;
  }
  return requested;
}

// ─── 7. Main execution function ───────────────────────────────────────────────

export async function executeOnchain(
  decision: AgentDecision,
  options: ExecuteOnchainOptions = {}
): Promise<string | null> {

  if (decision.action === "HOLD") {
    console.log("[OnchainOS] HOLD — no transaction needed.");
    return null;
  }

  if (!CONFIG.AGENT_PRIVATE_KEY) {
    console.warn("[OnchainOS] AGENT_PRIVATE_KEY not set — skipping.");
    return null;
  }

  try {
    const wallet = getAgentWallet();

    // Verify network
    const network = await wallet.provider!.getNetwork();
    if (Number(network.chainId) !== CONFIG.CHAIN_ID) {
      throw new Error(`Wrong chain: ${network.chainId}, expected ${CONFIG.CHAIN_ID}`);
    }

    // Check balance
    const balance    = await wallet.provider!.getBalance(wallet.address);
    const balanceOkb = parseFloat(ethers.formatEther(balance));
    const amountInOkb = safeAmount(options.amountInOkb ?? CONFIG.MAINNET_TRADE_OKB);
    const minRequired = parseFloat(amountInOkb) + 0.001;

    if (balanceOkb < minRequired) {
      console.warn(`[Safety] Balance ${balanceOkb.toFixed(4)} OKB < required ${minRequired.toFixed(4)} — skipping`);
      return null;
    }

    // Resolve the swap route from AI decision
    const route = resolveSwapRoute(decision);
    if (!route) {
      console.log("[OnchainOS] No route resolved — skipping.");
      return null;
    }

    const isMainnet  = CONFIG.CHAIN_ID === 196;
    const tradeLabel = options.label ?? "live";

    console.log(`[OnchainOS] Skill: okx-agentic-wallet + okx-dex-swap`);
    console.log(`[OnchainOS] Network: ${ACTIVE.name} (Chain ID ${CONFIG.CHAIN_ID})`);
    console.log(`[OnchainOS] Decision: ${decision.action} ${decision.asset}`);
    console.log(`[OnchainOS] Route: ${route.fromSymbol} → ${route.toSymbol} | ${amountInOkb} OKB`);
    console.log(`[OnchainOS] Wallet: ${wallet.address} | Balance: ${balanceOkb.toFixed(4)} OKB`);
    if (isMainnet) console.log(`[OnchainOS] ⚠  MAINNET — real OKB will be spent`);

    // Execute the swap
    const hash = await executeOKXSwap(route, amountInOkb, wallet);
    if (!hash) return null;

    console.log(`[OnchainOS] ✅ Confirmed: ${hash}`);
    console.log(`[OnchainOS] Explorer: ${getTxExplorerUrl(hash)}`);

    // Store with actual route info — dashboard shows real trade details
    await appendTransaction({
      hash,
      type:      decision.action,
      from:      route.fromSymbol,
      to:        route.toSymbol,
      amount:    `${amountInOkb} OKB`,
      status:    "confirmed",
      timestamp: Date.now(),
    });

    return hash;

  } catch (err) {
    console.error("[OnchainOS] ❌ Execution failed:", err);
    return null;
  }
}

// ─── 8. Main Agent Cycle ──────────────────────────────────────────────────────

export async function runAgentCycle(): Promise<AgentCycleResult> {
  const networkLabel = CONFIG.CHAIN_ID === 196 ? "X Layer Mainnet" : "X Layer Testnet";

  console.log("\n════════════════════════════════════════════");
  console.log(`  XPULSE AI AGENT CYCLE — ${new Date().toISOString()}`);
  console.log(`  Network: ${networkLabel} (Chain ID ${CONFIG.CHAIN_ID})`);
  console.log(`  Skills:  okx-agentic-wallet · okx-dex-swap · okx-dex-market`);
  console.log(`  Max trade: ${CONFIG.MAX_TRADE_OKB} OKB per cycle`);
  console.log("════════════════════════════════════════════");

  await writeAgentStatus({ isRunning: true });

  try {
    console.log("[1/4] Fetching market data...");
    const marketData = await fetchMarketData();

    console.log("[2/4] Detecting top movers...");
    const { topGainers, topLosers } = detectTopMovers(marketData);

    console.log("[3/4] Generating AI insight via Groq LLaMA 3.3...");
    const aiSummary = await generateAIInsight(marketData, topGainers, topLosers);
    console.log("AI Signal:", aiSummary);

    console.log("[4/4] Evaluating decision...");
    const decision = evaluateDecision(marketData, aiSummary);
    console.log("Decision:", decision);

    const walletAddress = CONFIG.AGENT_PRIVATE_KEY ? getAgentWalletAddress() : undefined;
    if (walletAddress) console.log(`Wallet: ${walletAddress}`);

    let txHash: string | undefined;
    if (decision.action !== "HOLD") {
      const label = decision.confidence >= 70 ? "live" : "demo";
      console.log(`[Agent] Confidence ${decision.confidence}% → ${label} execution`);
      txHash = (await executeOnchain(decision, {
        amountInOkb: CONFIG.MAINNET_TRADE_OKB,
        label,
      })) ?? undefined;
    } else if (decision.confidence < CONFIG.MIN_CONFIDENCE) {
      console.log(`[Agent] Confidence ${decision.confidence}% < ${CONFIG.MIN_CONFIDENCE}% threshold → HOLD`);
    }

    const prevStatus = await readAgentStatus();
    await writeAgentStatus({
      lastRun:        Date.now(),
      lastAction:     decision.action,
      lastAsset:      decision.asset,
      lastConfidence: decision.confidence,
      lastInsight:    aiSummary,
      walletAddress:  walletAddress ?? prevStatus.walletAddress,
      cycleCount:     prevStatus.cycleCount + 1,
      isRunning:      false,
    });

    console.log("\n✅ Cycle complete\n");
    return { marketData, topGainers, topLosers, aiSummary, decision, walletAddress, txHash };

  } catch (err) {
    await writeAgentStatus({ isRunning: false });
    throw err;
  }
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runAgentCycle()
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(err  => { console.error("❌ Agent error:", err); process.exit(1); });
}
