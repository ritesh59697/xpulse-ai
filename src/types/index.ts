// src/types/index.ts
// Shared TypeScript types for Xpulse AI

export interface CoinData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  image: string;
}

export type ActionType = "BUY" | "SELL" | "HOLD" | "SWAP";

export interface AgentDecision {
  action: ActionType;
  asset: string;
  targetAsset?: string;
  amount: string;
  reason: string;
  confidence: number; // 0–100
  timestamp: number;
}

export interface Transaction {
  hash: string;
  type: ActionType | string;
  from: string;
  to: string;
  amount: string;
  status: "confirmed" | "pending" | "failed";
  time: string;
}

export interface AgentCycleResult {
  marketData: CoinData[];
  topGainers: CoinData[];
  topLosers: CoinData[];
  aiSummary: string;
  decision: AgentDecision;
  txHash?: string;
}
