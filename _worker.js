export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/xauusd") {
      const requested = url.searchParams.get("interval") || "15m";
      const allowed = new Set(["5m", "15m", "30m", "1h", "4h"]);
      const safeInterval = allowed.has(requested) ? requested : "15m";

      // Primary: public Biquote MT5 XAUUSD feed. No API key required.
      try {
        const endpoint = new URL("https://biquote.io/api/XAUUSD/ohlc");
        endpoint.searchParams.set("interval", safeInterval);
        endpoint.searchParams.set("limit", "1000");
        const response = await fetch(endpoint.toString(), {
          headers: { "Accept": "application/json", "User-Agent": "Smart-Gold-V10-Pro/1.0" },
          cf: { cacheTtl: 15, cacheEverything: true }
        });

        if (response.ok) {
          const data = await response.json();
          const bars = Array.isArray(data?.bars) ? data.bars : [];
          const valid = bars.filter(b => b?.openTime &&
            Number.isFinite(Number(b.open)) && Number.isFinite(Number(b.high)) &&
            Number.isFinite(Number(b.low)) && Number.isFinite(Number(b.close)));

          if (valid.length >= 220) {
            const ascending = [...valid].reverse();
            const timestamp = ascending.map(b => Math.floor(Date.parse(b.openTime) / 1000));
            const open = ascending.map(b => Number(b.open));
            const high = ascending.map(b => Number(b.high));
            const low = ascending.map(b => Number(b.low));
            const close = ascending.map(b => Number(b.close));
            const volume = ascending.map(b => Number(b.tickVolume ?? b.volume ?? 0));
            let regularMarketPrice = close[close.length - 1];
            let regularMarketChangePercent = null;

            try {
              const tickRes = await fetch("https://biquote.io/api/XAUUSD?allowStale=false", {
                headers: { "Accept": "application/json", "User-Agent": "Smart-Gold-V10-Pro/1.0" },
                cf: { cacheTtl: 10, cacheEverything: true }
              });
              if (tickRes.ok) {
                const tick = await tickRes.json();
                if (Number.isFinite(Number(tick?.mid))) regularMarketPrice = Number(tick.mid);
                if (Number.isFinite(Number(tick?.dayDiffPercent))) regularMarketChangePercent = Number(tick.dayDiffPercent);
              }
            } catch (_) {}

            return Response.json({
              chart: { result: [{
                meta: { symbol: "XAUUSD", regularMarketPrice, regularMarketChangePercent, source: "Biquote / MT5 XAUUSD" },
                timestamp,
                indicators: { quote: [{ open, high, low, close, volume }] }
              }], error: null }
            }, { status: 200, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
          }
        }
      } catch (_) {}

      // Secondary fallback: Yahoo Finance.
      const yahooInterval = safeInterval === "4h" ? "1h" : safeInterval;
      const range = ["5m", "15m", "30m"].includes(yahooInterval) ? "1mo" : "6mo";
      const upstreams = [
        "https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X",
        "https://query2.finance.yahoo.com/v8/finance/chart/XAUUSD=X"
      ];

      for (const endpoint of upstreams) {
        const upstream = new URL(endpoint);
        upstream.searchParams.set("interval", yahooInterval);
        upstream.searchParams.set("range", range);
        upstream.searchParams.set("includePrePost", "false");
        upstream.searchParams.set("events", "history");
        upstream.searchParams.set("lang", "en-US");
        upstream.searchParams.set("region", "US");
        try {
          const response = await fetch(upstream.toString(), {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
              "Accept": "application/json,text/plain,*/*"
            }
          });
          if (response.ok) {
            const body = await response.text();
            return new Response(body, { status: 200, headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              "Access-Control-Allow-Origin": "*"
            }});
          }
        } catch (_) {}
      }

      return Response.json(
        { error: "upstream_unavailable", message: "Le flux XAU/USD est temporairement indisponible. Le moteur reste verrouillé." },
        { status: 502, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } }
      );
    }

    if (url.pathname === "/smart-gold-v10-pro-macd" || url.pathname === "/smart-gold-v10-pro-macd/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/smart-gold-v10-pro-macd.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
