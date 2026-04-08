import { NextResponse } from "next/server";
import Groq from "groq-sdk";

interface CoinData {
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number;
}

export async function POST(req: Request) {
  try {
    const { marketData } = await req.json();

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ insight: "⚠ GROQ_API_KEY not set in environment variables." });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const summary = (marketData as CoinData[])
      ?.slice(0, 5)
      .map((c) => `${c.symbol.toUpperCase()}: $${c.current_price?.toFixed(2)} (${c.price_change_percentage_24h?.toFixed(2)}% 24h)`)
      .join(", ") || "No market data available";

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: `You are Xpulse AI, an autonomous trading agent deployed on X Layer blockchain.
Current market data: ${summary}
Analyze in 2-3 sharp sentences. Be decisive and data-driven.
End with exactly: ACTION: [BUY/SELL/HOLD] [ASSET] - [REASON]`,
        },
      ],
      max_tokens: 250,
      temperature: 0.4,
    });

    const insight = completion.choices[0]?.message?.content || "Market signal unavailable.";
    return NextResponse.json({ insight });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message, insight: "⚠ AI analysis failed. Check your GROQ_API_KEY." }, { status: 500 });
  }
}
