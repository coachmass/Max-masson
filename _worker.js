const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(data,status=200,cacheControl="no-store")=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json;charset=utf-8","Cache-Control":cacheControl}});
const GRANULARITY={"5m":"M5","15m":"M15","30m":"M30","1h":"H1","4h":"H4"};

async function oanda(env,interval,count=5000,to=null){
  if(!env.OANDA_API_TOKEN) throw new Error("OANDA_API_TOKEN missing");
  const u=new URL("https://api-fxtrade.oanda.com/v3/instruments/XAU_USD/candles");
  u.searchParams.set("price","MBA");
  u.searchParams.set("granularity",GRANULARITY[interval]||"M15");
  u.searchParams.set("count",String(Math.min(5000,Math.max(80,Number(count)||5000))));
  if(to)u.searchParams.set("to",to);
  const r=await fetch(u,{headers:{Authorization:`Bearer ${env.OANDA_API_TOKEN}`,Accept:"application/json"}});
  if(!r.ok) throw new Error("OANDA "+r.status+" "+(await r.text()).slice(0,180));
  const d=await r.json(), candles=(d.candles||[]).filter(x=>x?.mid&&x?.bid&&x?.ask&&x.complete===true);
  if(candles.length<40) throw new Error("Not enough OANDA candles");
  const timestamp=[],open=[],high=[],low=[],close=[],volume=[];
  const bidOpen=[],bidHigh=[],bidLow=[],bidClose=[];
  const askOpen=[],askHigh=[],askLow=[],askClose=[];
  for(const x of candles){
    timestamp.push(Math.floor(Date.parse(x.time)/1000));
    open.push(Number(x.mid.o)); high.push(Number(x.mid.h)); low.push(Number(x.mid.l)); close.push(Number(x.mid.c)); volume.push(Number(x.volume||0));
    bidOpen.push(Number(x.bid.o)); bidHigh.push(Number(x.bid.h)); bidLow.push(Number(x.bid.l)); bidClose.push(Number(x.bid.c));
    askOpen.push(Number(x.ask.o)); askHigh.push(Number(x.ask.h)); askLow.push(Number(x.ask.l)); askClose.push(Number(x.ask.c));
  }
  return {chart:{result:[{meta:{symbol:"XAU_USD",source:"OANDA",priceComponents:"MBA"},timestamp,indicators:{quote:[{open,high,low,close,volume,bidOpen,bidHigh,bidLow,bidClose,askOpen,askHigh,askLow,askClose}]}}],error:null},source:"OANDA / XAU_USD · MID/BID/ASK",proxy:false,fresh:Date.now()};
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(url.pathname==="/api/xauusd"){
    const interval=["5m","15m","30m","1h","4h"].includes(url.searchParams.get("interval"))?url.searchParams.get("interval"):"15m";
    const count=Math.min(5000,Math.max(80,Number(url.searchParams.get("count"))||5000));
    const to=url.searchParams.get("to")||null;
    const cacheUrl=new URL("/api/xauusd",url.origin);
    cacheUrl.searchParams.set("interval",interval);
    cacheUrl.searchParams.set("count",String(count));
    if(to)cacheUrl.searchParams.set("to",to);
    const cacheKey=new Request(cacheUrl.toString(),{method:"GET"});
    const edgeCache=typeof caches!=="undefined"?caches.default:null;
    if(edgeCache){
      const cached=await edgeCache.match(cacheKey);
      if(cached)return cached;
    }
    try{
      const ttl=to?21600:20;
      const response=json(await oanda(env,interval,count,to),200,`public, max-age=${to?300:10}, s-maxage=${ttl}`);
      if(edgeCache&&ctx?.waitUntil)ctx.waitUntil(edgeCache.put(cacheKey,response.clone()));
      return response;
    }
    catch(e){return json({error:"oanda_unavailable",message:String(e?.message||e),signalLocked:true},502);}
  }
  if(!env.ASSETS || typeof env.ASSETS.fetch!=="function") return json({error:"assets_binding_missing",message:"Cloudflare ASSETS binding unavailable"},503);
  if(url.pathname==="/smart-gold-v10-pro-macd"||url.pathname==="/smart-gold-v10-pro-macd/")return env.ASSETS.fetch(new Request(new URL("/smart-gold-v10-pro-macd.html",request.url),request));
  return env.ASSETS.fetch(request);
}};
