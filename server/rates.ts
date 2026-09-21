type Rate = { date: string; usdTry: number; source: string };
let cache: { value: Rate; fetchedAt: number } | null = null;

export function parseDovizRate(body: unknown): Rate {
  if (!body || typeof body !== "object") throw new Error("Invalid Doviz.dev response");
  const data = body as { USDTRY?: unknown; _meta?: { updated_at?: unknown; source?: unknown } };
  const usdTry = Number(data.USDTRY);
  const updatedAt = typeof data._meta?.updated_at === "string" ? data._meta.updated_at : "";
  if (!Number.isFinite(usdTry) || usdTry <= 0 || !/^\d{4}-\d{2}-\d{2}/.test(updatedAt)) throw new Error("Invalid Doviz.dev response");
  return { date: updatedAt.slice(0, 10), usdTry, source: "Doviz.dev · TCMB" };
}

export async function latestRate(): Promise<Rate | null> {
  if (cache && Date.now() - cache.fetchedAt < 10 * 60 * 1000) return cache.value;
  try {
    const response = await fetch("https://doviz.dev/v1/try.json", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Spawn/0.1" },
    });
    if (!response.ok) throw new Error(`Doviz.dev ${response.status}`);
    const value = parseDovizRate(await response.json());
    cache = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return cache?.value ?? null;
  }
}
