import { NextResponse } from "next/server";

// This route triggers one full agent cycle with the same real execution path
// used by the CLI runner.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { runAgentCycle } = await import("../../../agent/xpulse-agent");
    const result = await runAgentCycle();

    return NextResponse.json({
      success: true,
      cycleTime: new Date().toISOString(),
      marketCoins: result.marketData.length,
      insight: result.aiSummary,
      decision: result.decision,
      walletAddress: result.walletAddress,
      txHash: result.txHash ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Agent cycle failed]", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Also allow GET so the Vercel cron can hit it
export async function GET() {
  return POST();
}
