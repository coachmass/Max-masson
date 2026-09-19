const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type","Cache-Control":"no-store"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json;charset=utf-8"}});
const GRANULARITY={"5m":"M5","15m":"M15","30m":"M30","1h":"H1","4h":"H4"};
const ACCESS_HASH="62eb7cddaeeb5c845967a3a9aa98d5fbc5a41885d80359cad81ab0f122f17982";
const COOKIE_NAME="smart_gold_access";

async function sha256(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function validAccess(request,url){
  const key=url.searchParams.get("key");
  if(key&&await sha256(key)===ACCESS_HASH)return {valid:true,key};
  const cookies=request.headers.get("Cookie")||"";
  const value=cookies.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+"="))?.slice(COOKIE_NAME.length+1);
  return {valid:Boolean(value&&await sha256(decodeURIComponent(value))===ACCESS_HASH),key:null};
}
function privatePage(){
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Smart Gold · Accès privé</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(160deg,#04070b,#0b1521);color:#eef3f8;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.box{width:min(460px,100%);padding:30px;border:1px solid #26364f;border-radius:22px;background:#0c131ef7;box-shadow:0 20px 70px #0008}.logo{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#f5c542;color:#111;font-size:21px;font-weight:900}h1{font-size:25px;margin:20px 0 10px}p{color:#9aa7ba;line-height:1.55;margin:0}.lock{color:#f5c542;font-weight:800;margin-top:18px}</style></head><body><main class="box"><div class="logo">Au</div><h1>Accès privé</h1><p>Smart Gold est réservé aux personnes autorisées par Maxime. Ouvre le lien privé complet qui t’a été envoyé.</p><p class="lock">🔒 Aucun signal ni donnée de marché n’est accessible ici.</p></main></body></html>`,{status:403,headers:{"Content-Type":"text/html;charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow, noarchive","Referrer-Policy":"no-referrer"}});
}
function secure(response){
  const headers=new Headers(response.headers);
  headers.set("Cache-Control","private, no-store");
  headers.set("X-Robots-Tag","noindex, nofollow, noarchive");
  headers.set("Referrer-Policy","no-referrer");
  headers.set("X-Content-Type-Options","nosniff");
  headers.set("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy","default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

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
  const access=await validAccess(request,url);
  if(!access.valid)return privatePage();
  if(access.key){
    url.searchParams.delete("key");
    return new Response(null,{status:302,headers:{Location:url.toString(),"Set-Cookie":`${COOKIE_NAME}=${encodeURIComponent(access.key)}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }
  if(url.pathname==="/api/xauusd"){
    const interval=["5m","15m","30m","1h","4h"].includes(url.searchParams.get("interval"))?url.searchParams.get("interval"):"15m";
    const count=Math.min(5000,Math.max(80,Number(url.searchParams.get("count"))||5000));
    const to=url.searchParams.get("to")||null;
    try{return secure(json(await oanda(env,interval,count,to)));}
    catch(e){return secure(json({error:"oanda_unavailable",message:String(e?.message||e),signalLocked:true},502));}
  }
  if(!env.ASSETS || typeof env.ASSETS.fetch!=="function") return secure(json({error:"assets_binding_missing",message:"Cloudflare ASSETS binding unavailable"},503));
  if(url.pathname==="/smart-gold-v10-pro-macd"||url.pathname==="/smart-gold-v10-pro-macd/")return secure(await env.ASSETS.fetch(new Request(new URL("/smart-gold-v10-pro-macd.html",request.url),request)));
  return secure(await env.ASSETS.fetch(request));
}};
