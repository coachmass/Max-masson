const ORIGIN = "https://max-massonll.maxime-masson98.workers.dev";
const BAR = 300000;
const HOLD = 144; // 12 hours on M5

async function fetchHistory(target = 220000) {
  const all = [], seen = new Set();
  let to = null;
  while (all.length < target) {
    const url = new URL("/api/xauusd", ORIGIN);
    url.searchParams.set("interval", "5m");
    url.searchParams.set("count", String(Math.min(5000, target - all.length)));
    url.searchParams.set("fresh", String(Date.now()));
    if (to) url.searchParams.set("to", to);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    if (!result || !q) throw new Error("Invalid OANDA response");
    const page = result.timestamp.map((t, i) => ({
      t: t * 1000,
      o: +q.open[i], h: +q.high[i], l: +q.low[i], c: +q.close[i],
      bo: +q.bidOpen[i], bh: +q.bidHigh[i], bl: +q.bidLow[i], bc: +q.bidClose[i],
      ao: +q.askOpen[i], ah: +q.askHigh[i], al: +q.askLow[i], ac: +q.askClose[i],
    })).filter(x => Object.values(x).every(Number.isFinite));
    if (!page.length) break;
    for (const x of page) if (!seen.has(x.t)) { seen.add(x.t); all.push(x); }
    all.sort((a, b) => a.t - b.t);
    to = new Date(all[0].t - 1).toISOString();
  }
  return all.slice(-target);
}

function ema(v, p) {
  const out = Array(v.length).fill(null), k = 2 / (p + 1);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i === p - 1) out[i] = sum / p;
    else if (i >= p) out[i] = v[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function atr(rows, p = 14) {
  const tr = Array(rows.length).fill(0), out = Array(rows.length).fill(null);
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    tr[i] = i ? Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - rows[i - 1].c), Math.abs(rows[i].l - rows[i - 1].c)) : rows[i].h - rows[i].l;
    sum += tr[i];
    if (i === p - 1) out[i] = sum / p;
    else if (i >= p) out[i] = (out[i - 1] * (p - 1) + tr[i]) / p;
  }
  return out;
}

function aggregate(rows, ms) {
  const map = new Map();
  for (const x of rows) {
    const t = Math.floor(x.t / ms) * ms;
    const b = map.get(t) || { t, o: x.o, h: x.h, l: x.l, c: x.c };
    b.h = Math.max(b.h, x.h); b.l = Math.min(b.l, x.l); b.c = x.c;
    map.set(t, b);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

function pack(rows) {
  const c = rows.map(x => x.c);
  return { e20: ema(c, 20), e50: ema(c, 50), a: atr(rows) };
}

function bias(p, i) {
  if (i < 55 || p.e20[i] == null || p.e50[i] == null) return 0;
  if (p.e20[i] > p.e50[i] && p.e20[i] > p.e20[i - 5]) return 1;
  if (p.e20[i] < p.e50[i] && p.e20[i] < p.e20[i - 5]) return -1;
  return 0;
}

const clocks = {
  ny: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }),
  london: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }),
};
function liquid(t) {
  const ny = +clocks.ny.format(new Date(t)), london = +clocks.london.format(new Date(t));
  return (ny >= 8 && ny < 13) || (london >= 8 && london < 13);
}

function metrics(trades) {
  let pnl = 0, peak = 0, dd = 0, gp = 0, gl = 0, wins = 0;
  for (const x of trades) {
    pnl += x.r; peak = Math.max(peak, pnl); dd = Math.max(dd, peak - pnl);
    if (x.r > 0) { gp += x.r; wins++; } else gl += Math.abs(x.r);
  }
  return { n: trades.length, pnl, pf: gl ? gp / gl : gp ? Infinity : 0, wr: trades.length ? wins / trades.length : 0, exp: trades.length ? pnl / trades.length : 0, dd };
}

function exitTrade(rows, start, side, entry, stop, targetR, exitMode, extraCost = 0) {
  const risk = (entry - stop) * side;
  const target = entry + side * risk * targetR;
  let sl = stop, favorable = entry;
  const last = Math.min(rows.length - 1, start + HOLD);
  for (let j = start; j <= last; j++) {
    const low = side === 1 ? rows[j].bl : rows[j].al;
    const high = side === 1 ? rows[j].bh : rows[j].ah;
    const hitSL = side === 1 ? low <= sl : high >= sl;
    const hitTP = side === 1 ? high >= target : low <= target;
    if (hitSL && hitTP) return { r: ((sl - entry) * side) / risk - 0.02 - extraCost, exit: j };
    if (hitSL) return { r: ((sl - entry) * side) / risk - 0.02 - extraCost, exit: j };
    if (hitTP) return { r: targetR - 0.02 - extraCost, exit: j };
    favorable = side === 1 ? Math.max(favorable, high) : Math.min(favorable, low);
    if (exitMode === "BE1" && (favorable - entry) * side >= risk) {
      sl = side === 1 ? Math.max(sl, entry) : Math.min(sl, entry);
    }
  }
  const close = side === 1 ? rows[last].bc : rows[last].ac;
  return { r: Math.max(-1, Math.min(targetR, ((close - entry) * side) / risk)) - 0.02 - extraCost, exit: last };
}

const rows = (await fetchHistory()).filter(x => x.t >= Date.now() - 3 * 365.25 * 86400000);
const m15 = aggregate(rows, 900000), h1 = aggregate(rows, 3600000), h4 = aggregate(rows, 14400000);
const p5 = { a: atr(rows) }, p15 = pack(m15), p1 = pack(h1), p4 = pack(h4);

function completedMap(tfRows, duration) {
  const out = Array(rows.length).fill(0); let k = 0;
  for (let i = 0; i < rows.length; i++) {
    const close = rows[i].t + BAR;
    while (k + 1 < tfRows.length && tfRows[k + 1].t + duration <= close) k++;
    out[i] = k;
  }
  return out;
}
const map15 = completedMap(m15, 900000), map1 = completedMap(h1, 3600000), map4 = completedMap(h4, 14400000);
const split = rows[0].t + (rows.at(-1).t - rows[0].t) * 0.75;
const purge = HOLD * BAR;

const configs = [];
for (const family of ["CONTINUATION", "RETRACEMENT"])
for (const side of [1, -1])
for (const sweepBars of [12, 24])
for (const confirmBars of [3, 6])
for (const targetR of family === "CONTINUATION" ? [1.5, 2] : [1, 1.5])
for (const exitMode of ["FIXED", "BE1"])
  configs.push({ family, side, sweepBars, confirmBars, targetR, exitMode });

function run(cfg, stress = {}) {
  const trades = [];
  for (let i = 60; i < rows.length - cfg.confirmBars - 2; i++) {
    if (!p5.a[i] || !liquid(rows[i].t)) continue;
    const b15 = bias(p15, map15[i]), b1 = bias(p1, map1[i]), b4 = bias(p4, map4[i]);
    // A continuation requires H1/H4 agreement. A shorter retracement only needs
    // a clear H1 bias to trade against; requiring an already-reversed M15 trend
    // would recognize the move too late.
    const dominant = cfg.family === "CONTINUATION"
      ? (b1 !== 0 && b1 === b4 ? b1 : 0)
      : b1;
    if (!dominant) continue;
    if (cfg.family === "CONTINUATION" && cfg.side !== dominant) continue;
    if (cfg.family === "RETRACEMENT" && cfg.side === dominant) continue;

    const prior = rows.slice(i - cfg.sweepBars, i);
    const level = cfg.side === 1 ? Math.min(...prior.map(x => x.l)) : Math.max(...prior.map(x => x.h));
    const swept = cfg.side === 1
      ? rows[i].l < level && rows[i].c > level
      : rows[i].h > level && rows[i].c < level;
    if (!swept) continue;
    const sweepExtreme = cfg.side === 1 ? rows[i].l : rows[i].h;
    const localStructure = cfg.side === 1
      ? Math.max(...rows.slice(i - 3, i + 1).map(x => x.h))
      : Math.min(...rows.slice(i - 3, i + 1).map(x => x.l));
    let confirm = -1;
    for (let j = i + 1; j <= i + cfg.confirmBars; j++) {
      const displacement = Math.abs(rows[j].c - rows[j].o) >= p5.a[j] * 0.35;
      const bos = cfg.side === 1 ? rows[j].c > localStructure : rows[j].c < localStructure;
      const candle = cfg.side === 1 ? rows[j].c > rows[j].o : rows[j].c < rows[j].o;
      if (bos && candle && displacement) { confirm = j; break; }
    }
    const entryIndex = confirm + 1 + (stress.delayBars || 0);
    if (confirm < 0 || entryIndex >= rows.length || !liquid(rows[entryIndex].t)) continue;
    // Continuations need full M15 agreement. Retracements only need price to
    // reclaim/lose the last completed M15 EMA20 after the M5 sweep + BOS.
    const entryM15 = bias(p15, map15[confirm]);
    if (cfg.family === "CONTINUATION" && entryM15 !== cfg.side) continue;
    if (cfg.family === "RETRACEMENT") {
      const e20 = p15.e20[map15[confirm]];
      const localTurn = cfg.side === 1 ? rows[confirm].c > e20 : rows[confirm].c < e20;
      if (!Number.isFinite(e20) || !localTurn) continue;
    }
    const quotedEntry = cfg.side === 1 ? rows[entryIndex].ao : rows[entryIndex].bo;
    const entry = quotedEntry + cfg.side * p5.a[confirm] * (stress.slipAtr || 0);
    const stop = sweepExtreme - cfg.side * p5.a[i] * 0.15;
    const risk = (entry - stop) * cfg.side;
    if (risk < 0.5 || risk > 20) continue;
    const result = exitTrade(rows, entryIndex, cfg.side, entry, stop, cfg.targetR, cfg.exitMode, stress.extraCost || 0);
    trades.push({ t: rows[entryIndex].t, r: result.r });
    i = result.exit;
  }
  const dev = trades.filter(x => x.t < split - purge), test = trades.filter(x => x.t >= split);
  const devStart = rows[0].t, devEnd = split - purge, width = (devEnd - devStart) / 3;
  const folds = [0, 1, 2].map(n => metrics(dev.filter(x => x.t >= devStart + n * width && x.t < (n === 2 ? devEnd : devStart + (n + 1) * width))));
  return { cfg, dev: metrics(dev), test: metrics(test), folds, positiveFolds: folds.filter(x => x.n >= 8 && x.pf >= 1.1 && x.exp > 0).length, trades };
}

const results = configs.map(run);
const passesDev = x => x.dev.n >= 40 && x.dev.pf >= 1.25 && x.dev.exp > 0 && x.positiveFolds >= 2;
const passesFinal = x => x.test.n >= 12 && x.test.pf >= 1.15 && x.test.exp > 0;
results.sort((a, b) => Number(passesDev(b)) - Number(passesDev(a)) || b.positiveFolds - a.positiveFolds || b.dev.exp - a.dev.exp);

const day = 86400000, wf = [], wfTrades = [];
for (let start = rows[0].t + 365 * day; start + 45 * day <= rows.at(-1).t; start += 45 * day) {
  const trainEnd = start - purge, end = start + 45 * day;
  let chosen = null, score = -Infinity;
  for (const x of results) {
    const train = x.trades.filter(t => t.t < trainEnd), m = metrics(train);
    if (m.n < 30 || m.pf < 1.2 || m.exp <= 0) continue;
    const width = (trainEnd - rows[0].t) / 3;
    const seg = [0, 1, 2].map(n => metrics(train.filter(t => t.t >= rows[0].t + n * width && t.t < (n === 2 ? trainEnd : rows[0].t + (n + 1) * width))));
    if (seg.filter(z => z.n >= 6 && z.exp > 0).length < 2) continue;
    const s = m.exp + Math.min(m.n, 100) / 1000;
    if (s > score) { score = s; chosen = x; }
  }
  if (!chosen) { wf.push({ start: new Date(start).toISOString().slice(0, 10), selected: null }); continue; }
  const forward = chosen.trades.filter(t => t.t >= start && t.t < end);
  wfTrades.push(...forward);
  wf.push({ start: new Date(start).toISOString().slice(0, 10), cfg: chosen.cfg, forward: metrics(forward) });
}

const strip = ({ trades, ...x }) => ({ ...x, passesDev: passesDev({ trades, ...x }), passesFinal: passesFinal({ trades, ...x }) });
const compact = x => ({
  cfg: x.cfg,
  dev: x.dev,
  test: x.test,
  positiveFolds: x.positiveFolds,
  passesDev: passesDev(x),
  passesFinal: passesFinal(x),
});
const candidateCfg = { family: "CONTINUATION", side: -1, sweepBars: 12, confirmBars: 6, targetR: 2, exitMode: "BE1" };
const stressTests = [
  { name: "BASE", options: {} },
  { name: "RETARD_5M", options: { delayBars: 1 } },
  { name: "GLISSEMENT_0.05_ATR", options: { slipAtr: 0.05 } },
  { name: "RETARD_GLISSEMENT_COUT", options: { delayBars: 1, slipAtr: 0.05, extraCost: 0.03 } },
].map(s => {
  const x = run(candidateCfg, s.options);
  return { name: s.name, dev: x.dev, test: x.test, positiveFolds: x.positiveFolds };
});
console.log(JSON.stringify({
  bars: rows.length,
  start: new Date(rows[0].t).toISOString(),
  end: new Date(rows.at(-1).t).toISOString(),
  tested: results.length,
  validated: results.filter(x => passesDev(x) && passesFinal(x)).map(compact),
  familySide: ["CONTINUATION", "RETRACEMENT"].flatMap(family => [1, -1].map(side => {
    const subset = results.filter(x => x.cfg.family === family && x.cfg.side === side)
      .sort((a, b) => Number(passesDev(b)) - Number(passesDev(a)) || b.positiveFolds - a.positiveFolds || b.dev.exp - a.dev.exp);
    return compact(subset[0]);
  })),
  walkForwardSelected: wf.filter(x => x.cfg).length,
  walkForwardPeriods: wf.length,
  walkForwardTotal: metrics(wfTrades),
  stressTests,
}, null, 2));
