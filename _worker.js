export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API XAU/USD
    if (url.pathname === "/api/xauusd") {
      const allowed = new Set(["5m", "15m", "30m", "60m", "1h"]);
      const interval = allowed.has(url.searchParams.get("interval"))
        ? url.searchParams.get("interval")
        : "15m";
      const range = ["5m", "15m", "30m"].includes(interval) ? "1mo" : "6mo";

      const upstream = new URL("https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X");
      upstream.searchParams.set("interval", interval);
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
        const body = await response.text();
        return new Response(body, {
          status: response.status,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Access-Control-Allow-Origin": "*"
          }
        });
      } catch (error) {
        return Response.json(
          { error: "upstream_fetch_failed", message: String(error?.message || error) },
          { status: 502 }
        );
      }
    }

    // Clean URL: /smart-gold-v10-pro-macd
    // Cloudflare Assets serves the actual HTML file with .html, so map the
    // clean URL explicitly instead of letting Assets return a 404.
    if (url.pathname === "/smart-gold-v10-pro-macd" || url.pathname === "/smart-gold-v10-pro-macd/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/smart-gold-v10-pro-macd.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
