// src/app/api/transactions/route.ts
// Returns ONLY real transactions executed by the agent.
// No mock data. If no transactions yet, returns empty array.

import { NextResponse } from "next/server";
import { readTransactions, timeAgo } from "../../../lib/agent-store";

export async function GET() {
  try {
    const txs = await readTransactions();

    // Add human-readable relative time to each tx
    const result = txs.map(tx => ({
      ...tx,
      timeAgo: timeAgo(tx.timestamp),
    }));

    return NextResponse.json(result);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
