// scripts/run-agent.ts
// Autonomous agent runner — runs one cycle immediately, then repeats every 15 min.
// Usage:
//   Single cycle:    npx ts-node --project tsconfig.json scripts/run-agent.ts
//   Continuous loop: AGENT_LOOP=true npx ts-node --project tsconfig.json scripts/run-agent.ts

import * as path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const LOOP_MODE   = process.env.AGENT_LOOP === "true";

async function main() {
  const { runAgentCycle } = await import("../src/agent/xpulse-agent.ts");

  if (process.env.GROQ_API_KEY) {
    console.log("✅ GROQ_API_KEY loaded");
  } else {
    console.warn("⚠ GROQ_API_KEY missing — agent will HOLD on every cycle");
  }

  console.log(`\n🚀 Xpulse AI Agent starting...`);
  console.log(`   Mode:     ${LOOP_MODE ? "CONTINUOUS LOOP (every 15 min)" : "SINGLE CYCLE"}`);
  console.log(`   Network:  X Layer Mainnet (Chain ID 196)\n`);

  // Run first cycle immediately
  await runCycleWithSummary(runAgentCycle);

  if (LOOP_MODE) {
    console.log(`\n⏱  Next cycle in 15 minutes. Press Ctrl+C to stop.\n`);

    setInterval(async () => {
      await runCycleWithSummary(runAgentCycle);
      console.log(`\n⏱  Next cycle in 15 minutes.\n`);
    }, INTERVAL_MS);
  }
}

async function runCycleWithSummary(runAgentCycle: () => Promise<{
  decision: { action: string; asset: string; confidence: number; reason: string };
  walletAddress?: string;
  txHash?: string;
}>) {
  try {
    const result = await runAgentCycle();

    console.log("\n════════════════════════════════════════");
    console.log("  CYCLE RESULT");
    console.log("════════════════════════════════════════");
    console.log(`Action:     ${result.decision.action}`);
    console.log(`Asset:      ${result.decision.asset}`);
    console.log(`Confidence: ${result.decision.confidence}%`);
    console.log(`Reason:     ${result.decision.reason}`);
    if (result.walletAddress) {
      console.log(`Wallet:     ${result.walletAddress}`);
      console.log(`Explorer:   https://www.oklink.com/xlayer/address/${result.walletAddress}`);
    }
    if (result.txHash) {
      console.log(`TX Hash:    ${result.txHash}`);
      console.log(`TX Link:    https://www.oklink.com/xlayer/tx/${result.txHash}`);
    }
    console.log("════════════════════════════════════════\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Cycle failed: ${msg}\n`);
  }
}

main().catch(err => {
  console.error("❌ Agent startup failed:", err.message);
  process.exit(1);
});
