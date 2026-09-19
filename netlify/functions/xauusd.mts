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
  const endpoint = new URL("https://api-fxtrade.oanda.com/v3/instruments/XAU_USD/candles");
  endpoint.searchParams.set("price","M");
  endpoint.searchParams.set("granularity",granularity);
  endpoint.searchParams.set("count","5000");

  const upstream = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    return Response.json({ error:"OANDA request failed", status:upstream.status, detail:detail.slice(0,300) }, { status:502 });
  }

  const data:any = await upstream.json();
  const candles = (data.candles || []).filter((x:any)=>x?.mid);
  const timestamp:number[] = [];
  const open:number[] = [], high:number[] = [], low:number[] = [], close:number[] = [], volume:number[] = [];
  for (const x of candles) {
    timestamp.push(Math.floor(new Date(x.time).getTime()/1000));
    open.push(Number(x.mid.o)); high.push(Number(x.mid.h)); low.push(Number(x.mid.l)); close.push(Number(x.mid.c)); volume.push(Number(x.volume || 0));
  }
  return Response.json({
    chart:{ result:[{ meta:{symbol:"XAU_USD",exchangeName:"OANDA",instrumentType:"CURRENCY"}, timestamp,
      indicators:{quote:[{open,high,low,close,volume}]}
    }], error:null }
  }, { headers:{"Cache-Control":"no-store"} });
};

export const config: Config = { path:"/api/xauusd" };
