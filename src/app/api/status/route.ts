// src/app/api/status/route.ts
// Returns real agent status: last run time, last action, wallet address.
// Dashboard polls this every 5 seconds.

import { NextResponse } from "next/server";
import { readAgentStatus, timeAgo } from "../../../lib/agent-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const status = await readAgentStatus();
    return NextResponse.json({
      lastRun:        status.lastRun,
      lastRunAgo:     timeAgo(status.lastRun),
      lastAction:     status.lastAction,
      lastAsset:      status.lastAsset,
      lastConfidence: status.lastConfidence,
      lastInsight:    status.lastInsight,
      lastReason:     status.lastReason,
      walletAddress:  status.walletAddress,
      cycleCount:     status.cycleCount,
      isRunning:      status.isRunning,
      lastTxHash:     status.lastTxHash,
      lastExecution:  status.lastExecution,
    });
  } catch {
    return NextResponse.json({ error: "Could not read agent status" }, { status: 500 });
  }
}
