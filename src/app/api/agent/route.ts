// src/app/api/agent/route.ts
// Triggers one full agent cycle.
// Returns tokenScores + chosenToken so the dashboard can show the scoring panel.

import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST() {
  try {
    const { runAgentCycle } = await import("../../../agent/xpulse-agent");
    const result = await runAgentCycle();

    return NextResponse.json({
      success:      true,
      cycleTime:    new Date().toISOString(),
      insight:      result.aiSummary,
      decision:     result.decision,
      walletAddress: result.walletAddress,
      txHash:       result.txHash ?? null,
      // NEW: include token scoring results for dashboard
      tokenScores:  result.tokenScores  ?? [],
      chosenToken:  result.chosenToken  ?? "",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Agent cycle failed]", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}