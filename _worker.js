const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
const json=(data,status=200,cacheControl="no-store")=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json;charset=utf-8","Cache-Control":cacheControl}});
const GRANULARITY={"5m":"M5","15m":"M15","30m":"M30","1h":"H1","4h":"H4"};

// Setup only: no scheduled signals, trading orders or changes to the paper engine.
const TG_HEADERS={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY"};
const tgJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...TG_HEADERS,"Content-Type":"application/json;charset=utf-8"}});
async function telegram(env,method,body={}){
  let response,data;
  try{
    response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    data=await response.json();
  }catch{throw new Error("Telegram inaccessible. Réessaie plus tard.");}
  if(!response.ok||!data.ok)throw new Error(`Telegram a refusé la demande (HTTP ${response.status}). Vérifie la configuration du bot.`);
  return data.result;
}
async function setupAuthorized(request,env){
  if(typeof env.TELEGRAM_SETUP_KEY!=="string"||env.TELEGRAM_SETUP_KEY.length<24)return false;
  const supplied=request.headers.get("X-Telegram-Setup-Key")||"";
  if(supplied.length>512)return false;
  const digest=async value=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([digest(supplied),digest(env.TELEGRAM_SETUP_KEY)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
function telegramSetupPage(){
  const nonce=crypto.randomUUID().replaceAll("-","");
  const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart Gold · Connexion Telegram</title>
<style nonce="${nonce}">body{background:#0b101a;color:#eaf0fa;font:17px system-ui;max-width:640px;margin:40px auto;padding:20px}h1{color:#f4ca60}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font:inherit;border-radius:8px}button{background:#f4ca60;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#151e2c;padding:16px}small{color:#b5c1d4}</style>
<h1>Connexion Telegram</h1><p>Cette page connecte ton bot et envoie uniquement un test sur demande. Les alertes de marché ne sont pas activées.</p>
<p>Dans les secrets du Worker, ajoute <b>TELEGRAM_SETUP_KEY</b> : une nouvelle clé aléatoire d'au moins 24 caractères, différente du token Telegram. Saisis cette clé ici, jamais le token du bot.</p>
<input id="key" type="password" autocomplete="off" placeholder="Clé de configuration privée"><button id="status">1. Vérifier le bot</button>
<p>Ouvre <a href="https://t.me/Maxmasson98bot" target="_blank" rel="noopener noreferrer">@Maxmasson98bot</a> dans Telegram et envoie exactement :</p><pre id="command"></pre>
<button id="discover">2. Retrouver ma conversation privée</button>
<p>Après vérification de ton identité, copie l'identifiant retourné dans le secret Cloudflare <b>TELEGRAM_CHAT_ID</b>, puis redéploie le Worker. Confirme cet identifiant ci-dessous pour envoyer le test.</p>
<input id="chat" inputmode="numeric" autocomplete="off" placeholder="Identifiant de ma conversation privée"><button id="test">3. Envoyer un message de test</button>
<pre id="output" role="status">Aucun message envoyé.</pre><small>La clé reste seulement en mémoire dans cet onglet. Aucun réglage n'est enregistré par cette page. Après connexion, retire TELEGRAM_SETUP_KEY pour fermer l'accès de configuration.</small>
<script nonce="${nonce}">
const challenge=crypto.randomUUID().replaceAll('-','');
document.getElementById('command').textContent='/start '+challenge;
async function run(action){
const output=document.getElementById('output'),buttons=[...document.querySelectorAll('button')];
buttons.forEach(b=>b.disabled=true);output.textContent='Vérification…';
try{const response=await fetch('/api/telegram/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Setup-Key':document.getElementById('key').value},body:JSON.stringify({action,challenge,confirmChatId:document.getElementById('chat').value.trim()})});const data=await response.json();output.textContent=JSON.stringify(data,null,2);}catch{output.textContent='Connexion interrompue. Pour un test, vérifie Telegram avant de réessayer : le message peut avoir été livré.';}finally{buttons.forEach(b=>b.disabled=false);}}
for(const action of ['status','discover','test'])document.getElementById(action).addEventListener('click',()=>run(action));
</script></html>`;
  return new Response(html,{headers:{...TG_HEADERS,"Content-Type":"text/html;charset=utf-8","Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}});
}
async function telegramSetup(request,env){
  if(request.method==="GET")return telegramSetupPage();
  if(request.method!=="POST")return tgJson({error:"Méthode non autorisée"},405);
  const origin=request.headers.get("Origin");
  if(origin&&origin!==new URL(request.url).origin)return tgJson({error:"Origine non autorisée"},403);
  if(!await setupAuthorized(request,env))return tgJson({error:"Clé de configuration absente ou incorrecte (24 caractères minimum)."},401);
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return tgJson({error:"JSON requis"},415);
  if(!env.TELEGRAM_BOT_TOKEN)return tgJson({error:"Secret TELEGRAM_BOT_TOKEN manquant."},503);
  let input;
  try{const raw=await request.text();if(raw.length>2048)return tgJson({error:"Requête trop grande"},413);input=JSON.parse(raw);}catch{return tgJson({error:"JSON invalide"},400);}
  if(!input||!["status","discover","test"].includes(input.action))return tgJson({error:"Action invalide"},400);
  try{
    const bot=await telegram(env,"getMe");
    if(bot.is_bot!==true||bot.username?.toLowerCase()!=="maxmasson98bot")return tgJson({error:"Ce token ne correspond pas à @Maxmasson98bot."},409);
    if(input.action==="status")return tgJson({bot:bot.username,conversationConfiguree:/^[1-9][0-9]*$/.test(env.TELEGRAM_CHAT_ID||""),alertesAutomatiques:false});
    if(input.action==="discover"){
      if(!/^[a-f0-9]{32}$/.test(input.challenge||""))return tgJson({error:"Code de connexion invalide. Recharge la page."},400);
      const webhook=await telegram(env,"getWebhookInfo");
      if(webhook.url)return tgJson({error:"Un webhook utilise déjà ce bot. Aucune modification effectuée."},409);
      // No offset: do not acknowledge/consume pending updates or alter allowed_updates.
      const updates=await telegram(env,"getUpdates",{timeout:0,limit:100});
      const matches=updates.map(x=>x.message).filter(m=>m?.chat?.type==="private"&&m.from?.is_bot===false&&m.from.id===m.chat.id&&m.text==="/start "+input.challenge&&m.date*1000>Date.now()-15*60*1000);
      const chats=[...new Map(matches.map(m=>[String(m.chat.id),{chatId:String(m.chat.id),prenom:m.from.first_name||"",nom:m.from.last_name||"",username:m.from.username||""}])).values()];
      if(chats.length!==1)return tgJson({error:"Aucune conversation unique confirmée. Envoie le code de cette page au bot en privé, puis réessaie (validité 15 minutes)."},409);
      return tgJson({conversation:chats[0],instruction:"Vérifie ton identité, puis ajoute ce chatId au secret TELEGRAM_CHAT_ID. Aucun message envoyé."});
    }
    const chatId=String(env.TELEGRAM_CHAT_ID||"");
    if(!/^[1-9][0-9]*$/.test(chatId)||input.confirmChatId!==chatId)return tgJson({error:"Confirme exactement le TELEGRAM_CHAT_ID configuré avant l'envoi."},409);
    const chat=await telegram(env,"getChat",{chat_id:chatId});
    if(chat.type!=="private"||String(chat.id)!==chatId)return tgJson({error:"La destination doit être ta conversation privée."},409);
    await telegram(env,"sendMessage",{chat_id:chatId,text:"Smart Gold — test de connexion Telegram réussi. Ceci n'est pas un signal de trading. Les alertes automatiques ne sont pas encore activées."});
    return tgJson({testEnvoye:true,alertesAutomatiques:false});
  }catch(e){return tgJson({error:e.message},502);}
}

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
  if(url.pathname==="/api/telegram/setup")return telegramSetup(request,env);
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

// deploy-v10.7 2026-09-20T05:02:50.385Z
