import { NextResponse } from "next/server";

export async function GET() {
  const coins = ["bitcoin", "ethereum", "okb", "solana", "chainlink"];
  const marketsUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coins.join(",")}&order=market_cap_desc&sparkline=false`;
  const globalUrl = "https://api.coingecko.com/api/v3/global";

  try {
    const headers: Record<string, string> = {};
    if (process.env.COINGECKO_API_KEY) {
      headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
    }

    const [marketsRes, globalRes] = await Promise.all([
      fetch(marketsUrl, {
        next: { revalidate: 60 }, // cache for 60 seconds
        headers,
      }),
      fetch(globalUrl, {
        next: { revalidate: 60 },
        headers,
      }),
    ]);

    if (!marketsRes.ok) throw new Error(`CoinGecko markets error: ${marketsRes.status}`);
    if (!globalRes.ok) throw new Error(`CoinGecko global error: ${globalRes.status}`);

    const [coinsData, globalData] = await Promise.all([
      marketsRes.json(),
      globalRes.json(),
    ]);

    return NextResponse.json({
      coins: coinsData,
      global: {
        market_cap_usd: globalData?.data?.total_market_cap?.usd ?? null,
        market_cap_change_percentage_24h_usd:
          globalData?.data?.market_cap_change_percentage_24h_usd ?? null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
