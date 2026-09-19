type Rate = { date: string; usdTry: number; source: string };
let cache: { value: Rate; fetchedAt: number } | null = null;

export async function latestRate(): Promise<Rate | null> {
  if (cache && Date.now() - cache.fetchedAt < 6 * 60 * 60 * 1000) return cache.value;
  try {
    const response = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Spawn/0.1" },
    });
    if (!response.ok) throw new Error(`ECB ${response.status}`);
    const body = await response.text();
    const date = body.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
    const usd = Number(body.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/)?.[1]);
    const turkishLira = Number(body.match(/currency=['"]TRY['"]\s+rate=['"]([\d.]+)['"]/)?.[1]);
    if (!date || !Number.isFinite(usd) || !Number.isFinite(turkishLira) || usd <= 0) throw new Error("Invalid ECB feed");
    const value = { date, usdTry: turkishLira / usd, source: "ECB reference rate" };
    cache = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return cache?.value ?? null;
  }
}
