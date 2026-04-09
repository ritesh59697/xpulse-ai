// src/app/api/portfolio/route.ts
// Server-side balance fetcher — avoids CORS by calling RPC from Node, not browser.

import { NextResponse } from "next/server";
import { ethers }       from "ethers";
import { ACTIVE, getProvider } from "@/lib/xlayer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const WOKB = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
const ERC20_ABI = ["function balanceOf(address) external view returns (uint256)"];

export async function GET() {
  try {
    const walletAddress =
      process.env.AGENT_WALLET_ADDRESS ||   // optional explicit address
      (() => {
        // derive from private key if set
        const pk = process.env.AGENT_PRIVATE_KEY;
        if (!pk) return null;
        const key = pk.startsWith("0x") ? pk : `0x${pk}`;
        return new ethers.Wallet(key).address;
      })();

    if (!walletAddress) {
      return NextResponse.json({ okb: 0, wokb: 0, okbUsd: 0, wokbUsd: 0, totalUsd: 0, error: "No wallet address" });
    }

    const provider = getProvider();

    // Native OKB balance
    const okbWei  = await provider.getBalance(walletAddress);
    const okbBal  = parseFloat(ethers.formatEther(okbWei));

    // WOKB ERC-20 balance
    const wokbContract = new ethers.Contract(WOKB, ERC20_ABI, provider);
    const wokbWei      = await wokbContract.balanceOf(walletAddress);
    const wokbBal      = parseFloat(ethers.formatEther(wokbWei));

    // OKB price from CoinGecko (server-side — no CORS)
    let okbPrice = 52.4; // fallback
    try {
      const cgRes  = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd", { next: { revalidate: 60 } });
      const cgData = await cgRes.json();
      okbPrice     = cgData?.okb?.usd ?? okbPrice;
    } catch { /* use fallback */ }

    const okbUsd   = okbBal  * okbPrice;
    const wokbUsd  = wokbBal * okbPrice;
    const totalUsd = okbUsd + wokbUsd;

    return NextResponse.json({
      walletAddress,
      okb:      okbBal,
      wokb:     wokbBal,
      okbUsd,
      wokbUsd,
      totalUsd,
      okbPrice,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[Portfolio API] Error:", msg, `(network=${ACTIVE.name}, rpc=${process.env.X_LAYER_RPC_URL || ACTIVE.rpc})`);
    return NextResponse.json({ okb: 0, wokb: 0, okbUsd: 0, wokbUsd: 0, totalUsd: 0, error: msg }, { status: 500 });
  }
}
