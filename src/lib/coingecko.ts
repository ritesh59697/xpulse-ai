export function coinGeckoHeaders(): Record<string, string> {
  const apiKey = process.env.COINGECKO_API_KEY;
  if (!apiKey) return {};

  const keyType = (process.env.COINGECKO_API_KEY_TYPE || "demo").toLowerCase();
  return keyType === "pro"
    ? { "x-cg-pro-api-key": apiKey }
    : { "x-cg-demo-api-key": apiKey };
}
