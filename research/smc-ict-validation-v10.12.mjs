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
      v: +q.volume[i],
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
function sessionAt(t) {
  const ny = +clocks.ny.format(new Date(t)), london = +clocks.london.format(new Date(t));
  if (ny >= 8 && ny < 13) return "NY";
  if (london >= 8 && london < 13) return "LONDON";
  return "OTHER";
}
const liquid = t => sessionAt(t) !== "OTHER";

// Fixed before looking at the result: block new entries from 30 minutes before
// until 45 minutes after a scheduled high-impact USD release. Release times
// are expressed in America/New_York so daylight-saving changes are preserved.
const NEWS_WINDOW = { before: 30 * 60000, after: 45 * 60000 };
function newYorkTime(date, hour, minute) {
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let utc = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map(x => [x.type, x.value]));
    const rendered = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    utc += desired - rendered;
  }
  return utc;
}

const bls830Dates = [
  "2023-10-06", "2023-10-12", "2023-11-03", "2023-11-14", "2023-12-08", "2023-12-12",
  "2024-01-05", "2024-01-11", "2024-02-02", "2024-02-13", "2024-03-08", "2024-03-12",
  "2024-04-05", "2024-04-10", "2024-05-03", "2024-05-15", "2024-06-07", "2024-06-12",
  "2024-07-05", "2024-07-11", "2024-08-02", "2024-08-14", "2024-09-06", "2024-09-11",
  "2024-10-04", "2024-10-10", "2024-11-01", "2024-11-13", "2024-12-06", "2024-12-11",
  "2025-01-10", "2025-01-15", "2025-02-07", "2025-02-12", "2025-03-07", "2025-03-12",
  "2025-04-04", "2025-04-10", "2025-05-02", "2025-05-13", "2025-06-06", "2025-06-11",
  "2025-07-03", "2025-07-15", "2025-08-01", "2025-08-12", "2025-09-05", "2025-09-11",
  "2025-10-24", "2025-11-20", "2025-12-16", "2025-12-18",
  "2026-01-09", "2026-01-13", "2026-02-11", "2026-02-13", "2026-03-06", "2026-03-11",
  "2026-04-03", "2026-04-10", "2026-05-08", "2026-05-12", "2026-06-05", "2026-06-10",
  "2026-07-02", "2026-07-14", "2026-08-07", "2026-08-12", "2026-09-04", "2026-09-11",
];
const fomcDates = [
  "2023-09-20", "2023-11-01", "2023-12-13",
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16",
];
const newsEvents = [
  ...bls830Dates.map(date => ({ kind: "CPI_NFP", t: newYorkTime(date, 8, 30) })),
  ...fomcDates.map(date => ({ kind: "FOMC", t: newYorkTime(date, 14, 0) })),
].sort((a, b) => a.t - b.t);
function newsAt(t) {
  return newsEvents.find(event => t >= event.t - NEWS_WINDOW.before && t <= event.t + NEWS_WINDOW.after) || null;
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
  if (exitMode === "PARTIAL12") {
    const tp1 = entry + side * risk;
    const tp2 = entry + side * risk * 2;
    let partial = false;
    for (let j = start; j <= last; j++) {
      const low = side === 1 ? rows[j].bl : rows[j].al;
      const high = side === 1 ? rows[j].bh : rows[j].ah;
      if (!partial) {
        const hitSL = side === 1 ? low <= stop : high >= stop;
        const hitTP1 = side === 1 ? high >= tp1 : low <= tp1;
        // Conservative ordering when both levels occur inside one M5 candle.
        if (hitSL) return { r: -1.02 - extraCost, exit: j };
        if (hitTP1) partial = true;
      }
      if (partial) {
        const hitBE = side === 1 ? low <= entry : high >= entry;
        const hitTP2 = side === 1 ? high >= tp2 : low <= tp2;
        if (hitBE && hitTP2) return { r: 0.48 - extraCost, exit: j };
        if (hitBE) return { r: 0.48 - extraCost, exit: j };
        if (hitTP2) return { r: 1.48 - extraCost, exit: j };
      }
    }
    const close = side === 1 ? rows[last].bc : rows[last].ac;
    const rawR = ((close - entry) * side) / risk;
    const markedR = partial
      ? 0.5 + 0.5 * Math.max(0, Math.min(2, rawR))
      : Math.max(-1, Math.min(1, rawR));
    return { r: markedR - 0.02 - extraCost, exit: last };
  }
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
for (const exitMode of ["FIXED", "BE1", "PARTIAL12"])
  if (exitMode !== "PARTIAL12" || targetR === 2)
    configs.push({ family, side, sweepBars, confirmBars, targetR, exitMode });
for (const side of [1, -1])
for (const sweepBars of [12, 24])
for (const confirmBars of [3, 6])
  configs.push({ family: "RETRACEMENT", side, sweepBars, confirmBars, targetR: 2, exitMode: "PARTIAL12" });
// Predeclared entry filters: location in the recent range and/or relative M5 volume.
// These are tested only on continuation entries to avoid multiplying weak families.
for (const side of [1, -1])
for (const sweepBars of [12, 24])
for (const confirmBars of [3, 6])
for (const targetR of [1.5, 2])
for (const exitMode of ["FIXED", "BE1"])
for (const contextFilter of ["PD", "VOLUME", "PD_VOLUME"])
  configs.push({ family: "CONTINUATION", side, sweepBars, confirmBars, targetR, exitMode, contextFilter });
// Session isolation: same continuation logic, tested separately in London and New York.
for (const side of [1, -1])
for (const sweepBars of [12, 24])
for (const confirmBars of [3, 6])
for (const targetR of [1.5, 2])
for (const exitMode of ["FIXED", "BE1"])
for (const sessionFilter of ["LONDON", "NY"])
  configs.push({ family: "CONTINUATION", side, sweepBars, confirmBars, targetR, exitMode, sessionFilter });

function run(cfg, stress = {}) {
  const trades = [];
  const blockedNews = { CPI_NFP: 0, FOMC: 0 };
  for (let i = 60; i < rows.length - cfg.confirmBars - 2; i++) {
    if (!p5.a[i] || !liquid(rows[i].t)) continue;
    if (cfg.sessionFilter && sessionAt(rows[i].t) !== cfg.sessionFilter) continue;
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
    if (cfg.contextFilter?.includes("PD")) {
      const range = rows.slice(Math.max(0, i - 144), i);
      const rangeLow = Math.min(...range.map(x => x.l));
      const rangeHigh = Math.max(...range.map(x => x.h));
      const position = (rows[i].c - rangeLow) / (rangeHigh - rangeLow || 1);
      const inValueArea = cfg.side === 1 ? position <= 0.4 : position >= 0.6;
      if (!inValueArea) continue;
    }
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
    if (stress.newsFilter) {
      const event = newsAt(rows[entryIndex].t);
      if (event) { blockedNews[event.kind]++; continue; }
    }
    if (cfg.contextFilter?.includes("VOLUME")) {
      const volumeMean = rows.slice(Math.max(0, confirm - 20), confirm)
        .reduce((sum, x) => sum + x.v, 0) / Math.min(20, confirm);
      if (!(rows[confirm].v >= volumeMean * 1.15)) continue;
    }
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
    // Structure-led stop. The ATR component is only the breathing room beyond
    // the swept extreme; it is not a fixed pip distance.
    const stopAtrBuffer = cfg.stopAtrBuffer ?? 0.15;
    const stop = sweepExtreme - cfg.side * p5.a[i] * stopAtrBuffer;
    const risk = (entry - stop) * cfg.side;
    if (risk < 0.5 || risk > 20) continue;
    const result = exitTrade(rows, entryIndex, cfg.side, entry, stop, cfg.targetR, cfg.exitMode, stress.extraCost || 0);
    trades.push({ t: rows[entryIndex].t, r: result.r });
    i = result.exit;
  }
  const dev = trades.filter(x => x.t < split - purge), test = trades.filter(x => x.t >= split);
  const devStart = rows[0].t, devEnd = split - purge, width = (devEnd - devStart) / 3;
  const folds = [0, 1, 2].map(n => metrics(dev.filter(x => x.t >= devStart + n * width && x.t < (n === 2 ? devEnd : devStart + (n + 1) * width))));
  return { cfg, dev: metrics(dev), test: metrics(test), folds, positiveFolds: folds.filter(x => x.n >= 8 && x.pf >= 1.1 && x.exp > 0).length, trades, blockedNews };
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
const nyBuyCfg = { family: "CONTINUATION", side: 1, sweepBars: 12, confirmBars: 6, targetR: 2, exitMode: "FIXED", sessionFilter: "NY" };
const nyBuyStress = [
  { name: "BASE", options: {} },
  { name: "RETARD_5M", options: { delayBars: 1 } },
  { name: "GLISSEMENT_0.05_ATR", options: { slipAtr: 0.05 } },
  { name: "RETARD_GLISSEMENT_COUT", options: { delayBars: 1, slipAtr: 0.05, extraCost: 0.03 } },
].map(s => {
  const x = run(nyBuyCfg, s.options);
  return { name: s.name, dev: x.dev, test: x.test, positiveFolds: x.positiveFolds };
});
const nyBuyNewsFilter = [
  { name: "FILTRE_NEWS", options: { newsFilter: true } },
  { name: "FILTRE_NEWS_RETARD_5M", options: { newsFilter: true, delayBars: 1 } },
  { name: "FILTRE_NEWS_GLISSEMENT_0.05_ATR", options: { newsFilter: true, slipAtr: 0.05 } },
  { name: "FILTRE_NEWS_STRESS_COMPLET", options: { newsFilter: true, delayBars: 1, slipAtr: 0.05, extraCost: 0.03 } },
].map(s => {
  const x = run(nyBuyCfg, s.options);
  return { name: s.name, dev: x.dev, test: x.test, positiveFolds: x.positiveFolds, blockedNews: x.blockedNews };
});
// Stop flexibility study is selected on development only. Final-test metrics
// are deliberately not emitted because the final period has already been seen.
const stopBufferStudy = [0, 0.1, 0.15, 0.25, 0.35, 0.5].map(stopAtrBuffer => {
  const cfg = { ...nyBuyCfg, stopAtrBuffer };
  const base = run(cfg, { newsFilter: true });
  const stressed = run(cfg, { newsFilter: true, delayBars: 1, slipAtr: 0.05, extraCost: 0.03 });
  return {
    stopAtrBuffer,
    development: base.dev,
    positiveFolds: base.positiveFolds,
    stressedDevelopment: stressed.dev,
    stressedPositiveFolds: stressed.positiveFolds,
  };
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
  partialBest: ["CONTINUATION", "RETRACEMENT"].flatMap(family => [1, -1].map(side => {
    const subset = results.filter(x => x.cfg.family === family && x.cfg.side === side && x.cfg.exitMode === "PARTIAL12")
      .sort((a, b) => b.positiveFolds - a.positiveFolds || b.dev.exp - a.dev.exp);
    return compact(subset[0]);
  })),
  sessionBest: [1, -1].flatMap(side => ["LONDON", "NY"].map(sessionFilter => {
    const subset = results.filter(x => x.cfg.family === "CONTINUATION" && x.cfg.side === side && x.cfg.sessionFilter === sessionFilter)
      .sort((a, b) => Number(passesDev(b)) - Number(passesDev(a)) || b.positiveFolds - a.positiveFolds || b.dev.exp - a.dev.exp);
    return compact(subset[0]);
  })),
  walkForwardSelected: wf.filter(x => x.cfg).length,
  walkForwardPeriods: wf.length,
  walkForwardTotal: metrics(wfTrades),
  stressTests,
  nyBuyStress,
  newsFilter: {
    fixedWindowMinutes: { before: 30, after: 45 },
    officialEvents: { cpiNfp: bls830Dates.length, fomc: fomcDates.length },
    tests: nyBuyNewsFilter,
  },
  stopBufferStudy,
}, null, 2));
