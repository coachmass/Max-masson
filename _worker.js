export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // XAU/USD data proxy. The browser calls this same-origin endpoint so
    // CORS and Yahoo's upstream response never break the dashboard UI.
    if (url.pathname === "/api/xauusd") {
      const requested = url.searchParams.get("interval") || "15m";
      const interval = requested === "1h" ? "60m" : requested;
      const allowed = new Set(["5m", "15m", "30m", "60m"]);
      const safeInterval = allowed.has(interval) ? interval : "15m";
      const range = ["5m", "15m", "30m"].includes(safeInterval) ? "1mo" : "6mo";

      const upstreams = [
        "https://query1.finance.yahoo.com/v8/finance/chart/XAUUSD=X",
        "https://query2.finance.yahoo.com/v8/finance/chart/XAUUSD=X"
      ];

      for (const endpoint of upstreams) {
        const upstream = new URL(endpoint);
        upstream.searchParams.set("interval", safeInterval);
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
            return new Response(body, {
              status: 200,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
        } catch (_) {
          // Try the second Yahoo endpoint before returning an error.
        }
      }

      return Response.json(
        { error: "upstream_unavailable", message: "Le flux XAU/USD est temporairement indisponible." },
        { status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    // Clean public URL -> actual HTML asset.
    if (url.pathname === "/smart-gold-v10-pro-macd" || url.pathname === "/smart-gold-v10-pro-macd/") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/smart-gold-v10-pro-macd.html";
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  }
};
