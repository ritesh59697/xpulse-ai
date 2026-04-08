import { NextRequest, NextResponse } from "next/server";

const ALLOWED_COINS = new Set(["bitcoin", "ethereum", "solana", "chainlink", "okb"]);

export async function GET(req: NextRequest) {
  const coin = req.nextUrl.searchParams.get("coin") ?? "bitcoin";
  const normalizedCoin = coin.toLowerCase();

  if (!ALLOWED_COINS.has(normalizedCoin)) {
    return NextResponse.json({ error: "Unsupported coin" }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  }

  const url = `https://api.coingecko.com/api/v3/coins/${normalizedCoin}/market_chart?vs_currency=usd&days=1&interval=hourly`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers,
    });

    if (!res.ok) {
      throw new Error(`CoinGecko chart error: ${res.status}`);
    }

    const data = await res.json();
    const prices = Array.isArray(data?.prices) ? data.prices : [];

    const chart = prices.map((entry: [number, number]) => ({
      time: new Date(entry[0]).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }),
      price: Number(entry[1]),
    }));

    return NextResponse.json({ chart });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
