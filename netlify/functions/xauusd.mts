import type { Config } from "@netlify/functions";

const GRANULARITY: Record<string,string> = {
  "5m":"M5","15m":"M15","30m":"M30","1h":"H1","4h":"H4"
};

export default async (req: Request) => {
  const token = Netlify.env.get("OANDA_API_TOKEN");
  if (!token) return Response.json({ error: "OANDA_API_TOKEN missing" }, { status: 500 });

  const u = new URL(req.url);
  const interval = u.searchParams.get("interval") || "15m";
  const granularity = GRANULARITY[interval] || "M15";
  const count = Math.min(5000, Math.max(80, Number(u.searchParams.get("count")) || 5000));
  const to = u.searchParams.get("to");
  const endpoint = new URL("https://api-fxtrade.oanda.com/v3/instruments/XAU_USD/candles");
  endpoint.searchParams.set("price","MBA");
  endpoint.searchParams.set("granularity",granularity);
  endpoint.searchParams.set("count",String(count));
  if (to) endpoint.searchParams.set("to",to);

  const upstream = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json({ error:"OANDA request failed", status:upstream.status, detail:detail.slice(0,300) }, { status:502 });
  }

  const data:any = await upstream.json();
  const candles = (data.candles || []).filter((x:any)=>x?.mid && x?.bid && x?.ask && x.complete === true);
  const timestamp:number[] = [];
  const open:number[] = [], high:number[] = [], low:number[] = [], close:number[] = [], volume:number[] = [];
  const bidOpen:number[] = [], bidHigh:number[] = [], bidLow:number[] = [], bidClose:number[] = [];
  const askOpen:number[] = [], askHigh:number[] = [], askLow:number[] = [], askClose:number[] = [];
  for (const x of candles) {
    timestamp.push(Math.floor(new Date(x.time).getTime()/1000));
    open.push(Number(x.mid.o)); high.push(Number(x.mid.h)); low.push(Number(x.mid.l)); close.push(Number(x.mid.c)); volume.push(Number(x.volume || 0));
    bidOpen.push(Number(x.bid.o)); bidHigh.push(Number(x.bid.h)); bidLow.push(Number(x.bid.l)); bidClose.push(Number(x.bid.c));
    askOpen.push(Number(x.ask.o)); askHigh.push(Number(x.ask.h)); askLow.push(Number(x.ask.l)); askClose.push(Number(x.ask.c));
  }
  return Response.json({
    chart:{ result:[{ meta:{symbol:"XAU_USD",exchangeName:"OANDA",instrumentType:"CURRENCY",priceComponents:"MBA"}, timestamp,
      indicators:{quote:[{open,high,low,close,volume,bidOpen,bidHigh,bidLow,bidClose,askOpen,askHigh,askLow,askClose}]}
    }], error:null }
  }, { headers:{"Cache-Control":to ? "public, max-age=300, s-maxage=21600" : "public, max-age=10, s-maxage=20"} });
};

export const config: Config = { path:"/api/xauusd" };
