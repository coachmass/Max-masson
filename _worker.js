const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json;charset=utf-8"}});
const GRANULARITY={"5m":"M5","15m":"M15","30m":"M30","1h":"H1","4h":"H4"};

async function oanda(env,interval,count=5000,to=null){
  if(!env.OANDA_API_TOKEN) throw new Error("OANDA_API_TOKEN missing");
  const u=new URL("https://api-fxtrade.oanda.com/v3/instruments/XAU_USD/candles");
  u.searchParams.set("price","M");
  u.searchParams.set("granularity",GRANULARITY[interval]||"M15");
  u.searchParams.set("count",String(Math.min(5000,Math.max(80,Number(count)||5000))));
  if(to)u.searchParams.set("to",to);
  const r=await fetch(u,{headers:{Authorization:`Bearer ${env.OANDA_API_TOKEN}`,Accept:"application/json"}});
  if(!r.ok) throw new Error("OANDA "+r.status+" "+(await r.text()).slice(0,180));
  const d=await r.json(), candles=(d.candles||[]).filter(x=>x?.mid&&x.complete===true);
  if(candles.length<40) throw new Error("Not enough OANDA candles");
  const timestamp=[],open=[],high=[],low=[],close=[],volume=[];
  for(const x of candles){
    timestamp.push(Math.floor(Date.parse(x.time)/1000));
    open.push(Number(x.mid.o)); high.push(Number(x.mid.h)); low.push(Number(x.mid.l)); close.push(Number(x.mid.c)); volume.push(Number(x.volume||0));
  }
  return {chart:{result:[{meta:{symbol:"XAU_USD",source:"OANDA"},timestamp,indicators:{quote:[{open,high,low,close,volume}]}}],error:null},source:"OANDA / XAU_USD",proxy:false,fresh:Date.now()};
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(url.pathname==="/api/xauusd"){
    const interval=["5m","15m","30m","1h","4h"].includes(url.searchParams.get("interval"))?url.searchParams.get("interval"):"15m";
    const count=Math.min(5000,Math.max(80,Number(url.searchParams.get("count"))||5000));
    const to=url.searchParams.get("to")||null;
    try{return json(await oanda(env,interval,count,to));}
    catch(e){return json({error:"oanda_unavailable",message:String(e?.message||e),signalLocked:true},502);}
  }
  if(!env.ASSETS || typeof env.ASSETS.fetch!=="function") return json({error:"assets_binding_missing",message:"Cloudflare ASSETS binding unavailable"},503);
  if(url.pathname==="/smart-gold-v10-pro-macd"||url.pathname==="/smart-gold-v10-pro-macd/")return env.ASSETS.fetch(new Request(new URL("/smart-gold-v10-pro-macd.html",request.url),request));
  return env.ASSETS.fetch(request);
}};
