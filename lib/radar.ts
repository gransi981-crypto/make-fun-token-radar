// Token Radar's model, version radar-2: a comps-fitted implied value.
//
// The board ranks pre-token protocols by what a token would be worth if the
// protocol's record stayed as it is. The value is fitted from the snapshot
// itself, never from a hardcoded list of names:
//
//   comps fit   log10(market cap) = a + b * log10(TVL), fit by least squares
//               over the snapshot's own live-token protocols that carry both
//               figures. A bigger protocol's token is worth a smaller multiple
//               of its TVL, so the fitted multiple falls as TVL rises.
//   sector      each category's median ratio of actual to fitted market cap,
//               shrunk toward 1 by n / (n + 8), so a thin category cannot
//               swing the board on three protocols.
//   growth      the seven-day TVL change, clamped to [-40, +60] per cent,
//               weighted 0.6: a protocol still growing is worth more.
//   no-token    the days since the protocol was first listed, the clock of
//   clock         how long it has run with no token: 0.70 + 0.30 * age / 1460,
//               an unknown listing date counting as 365 days.
//   implied     TVL x comps multiple x sector x growth x no-token clock.
//
// The watchlist is the floor: every one of its slugs is ranked. The early
// radar adds pre-token protocols below the floor, by TVL, that pass the same
// exclusion rule the house used for the watchlist (no wrapped, staked or
// bridged product of a token that already trades, no exchange, no versioned
// pool). Live-token protocols are set aside with their market caps shown;
// they are never mixed into the ranked board.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The comps fit: the least-squares line through the live-token protocols. */
export interface CompsFit {
  intercept: number;
  slope: number;
  count: number;
  r2: number;
}

/** The model's tuned numbers, as the dashboard states them. */
export interface ModelParams {
  growthFloor: number;
  growthCap: number;
  growthWeight: number;
  clockFloor: number;
  clockRange: number;
  clockDays: number;
  unknownAgeDays: number;
  sectorShrink: number;
  sectorMin: number;
  sectorMax: number;
}

export const PARAMS: ModelParams = {
  growthFloor: -40,
  growthCap: 60,
  growthWeight: 0.6,
  clockFloor: 0.7,
  clockRange: 0.3,
  clockDays: 1460,
  unknownAgeDays: 365,
  sectorShrink: 8,
  sectorMin: 0.5,
  sectorMax: 2.5,
};

export const MODEL_VERSION = 'radar-2';

/** How many early rows the board carries beyond the watchlist. */
export const EARLY_TARGET = 160;

/** How many live-token protocols the dashboard's live view carries. */
export const LIVE_TARGET = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comps_multiple: number;
    sector_factor: number;
    growth_multiplier: number;
    clock_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  chg: number | null;
  age: number | null;
  implied: number;
  mult: number;
  sector: number;
  gmult: number;
  cmult: number;
}

/** A live-token protocol, shown with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  mcap: number | null;
  chg: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: CompsFit;
  sectors: Record<string, number>;
  params: ModelParams;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: Array<[number, number]>;
}

/** Why the snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to the snapshot date; null when unknown or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The comps line, fit on the snapshot's live-token protocols. */
export function fitComps(protocols: SnapshotProtocol[]): CompsFit {
  const pts = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)] as const);
  // Fallback from the 14 Nov snapshot's own fit, used only when the snapshot
  // carries too few comps to fit a line through.
  if (pts.length < 10) return { intercept: 3.025, slope: 0.522, count: pts.length, r2: 0 };
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    syy += (y - my) * (y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, count: n, r2 };
}

/** The comps multiple a TVL earns under the fit: it falls as TVL rises. */
export function compsMultiple(tvl: number, fit: CompsFit): number {
  if (tvl <= 0) return 0;
  return Math.pow(10, fit.intercept + (fit.slope - 1) * Math.log10(tvl));
}

/** A category's sector factor: its comps' median actual-to-fitted ratio, shrunk to 1. */
export function sectorFactors(protocols: SnapshotProtocol[], fit: CompsFit, params: ModelParams): Record<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const predicted = Math.pow(10, fit.intercept + fit.slope * Math.log10(p.tvl_usd));
    if (predicted <= 0) continue;
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd / predicted);
    byCategory.set(key, list);
  }
  const out: Record<string, number> = {};
  for (const [key, ratios] of byCategory) {
    if (ratios.length < 3) continue;
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const shrunk = 1 + (median - 1) * (ratios.length / (ratios.length + params.sectorShrink));
    out[key] = round4(clamp(shrunk, params.sectorMin, params.sectorMax));
  }
  return out;
}

/** Whether the protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house watchlist's exclusion rule, for the early radar: no wrapped, staked or bridged product of a token that already trades, no exchange, no versioned pool. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_TAIL.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_START.test(p.name)) return false;
  return true;
}

/** One protocol's score under the fitted model. */
export function scoreProtocol(
  p: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  sectors: Record<string, number>,
  params: ModelParams = PARAMS,
): { implied: number; multiple: number; sector: number; growthMult: number; clockMult: number; age: number | null } {
  const multiple = compsMultiple(p.tvl_usd, fit);
  const sector = sectors[p.category ?? 'Other'] ?? 1;
  const growth = clamp(p.change_7d ?? 0, params.growthFloor, params.growthCap);
  const growthMult = 1 + (growth / 100) * params.growthWeight;
  const age = ageDays(asOf, p.listed_at);
  const ageForClock = age ?? params.unknownAgeDays;
  const clockMult = params.clockFloor + params.clockRange * (Math.min(Math.max(ageForClock, 0), params.clockDays) / params.clockDays);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * sector * growthMult * clockMult));
  return { implied, multiple, sector, growthMult, clockMult, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on the protocol's first chain, in dollars. */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 9;
  if (c === 'solana') return 0.1;
  if (c.includes('arbitrum') || c.includes('base') || c.includes('optimism') || c.includes('polygon') || c.includes('bsc') || c.includes('binance') || c.includes('avalanche') || c.includes('zksync') || c.includes('linea') || c.includes('blast') || c.includes('scroll') || c.includes('mantle') || c.includes('mode') || c.includes('fantom')) return 0.5;
  if (c.includes('hyperliquid') || c.includes('monad') || c.includes('berachain') || c.includes('sui') || c.includes('aptos') || c.includes('sei') || c.includes('injective') || c.includes('cosmos') || c.includes('osmosis')) return 0.2;
  return 2;
}

/** The dollars one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 100_000_000) return 80;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('deriv') || c.includes('basis')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step as a single string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A protocol's farm plan: six steps, each derived from its own record. */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(chain);
  const gasText = gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
  return [
    {
      action: `Open a fresh wallet for this farm only and fund it with ${gasText} of ${chain}'s gas token from an exchange, keeping the seed phrase offline.`,
      cost: `${gasText} of gas to fund it`,
      time: '10 minutes',
    },
    {
      action: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      action: `Return once a week and make one real action — a deposit, a borrow, a swap or a vote — so the position stays active across snapshots.`,
      cost: `about ${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days, so the activity spans more than one points snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      action: `Check the protocol's own points or rewards page before you withdraw, and claim only from a link the protocol itself publishes — never from a reply, an ad or a DM.`,
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      action: `Log the wallet, the dates and every transaction hash, so you can repeat the position, prove it later or unwind it in one session.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The board: every watchlist slug, plus the early radar's pre-token rows, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, fit: CompsFit, sectors: Record<string, number>, params: ModelParams = PARAMS): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_TARGET);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, fit, sectors, params) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((x, i) => ({
    rank: i + 1,
    slug: x.p.slug,
    name: x.p.name,
    category: x.p.category,
    chains: x.p.chains,
    tvl_usd: x.p.tvl_usd,
    change_7d: x.p.change_7d,
    mcap_usd: x.p.mcap_usd,
    listed_at: x.p.listed_at,
    age_days: x.s.age,
    implied_value_usd: x.s.implied,
    model: {
      comps_multiple: round4(x.s.multiple),
      sector_factor: round4(x.s.sector),
      growth_multiplier: round4(x.s.growthMult),
      clock_multiplier: round4(x.s.clockMult),
    },
    farm_steps: farmPlan(x.p, x.s.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_TARGET)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl: p.tvl_usd,
      mcap: p.mcap_usd,
      chg: p.change_7d,
    }));
}

/** The comps points the dashboard's chart draws: [TVL, market cap] for every live comp. */
export function compsPoints(protocols: SnapshotProtocol[]): Array<[number, number]> {
  return protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => [p.tvl_usd, p.mcap_usd as number] as [number, number])
    .sort((a, b) => a[0] - b[0]);
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl: row.tvl_usd,
    chg: row.change_7d,
    age: row.age_days,
    implied: row.implied_value_usd,
    mult: row.model.comps_multiple,
    sector: row.model.sector_factor,
    gmult: row.model.growth_multiplier,
    cmult: row.model.clock_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitComps(snapshot.protocols);
  const sectors = sectorFactors(snapshot.protocols, fit, PARAMS);
  const board = buildBoard(snapshot, fit, sectors);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    sectors,
    params: PARAMS,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    comps: compsPoints(snapshot.protocols),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate takes`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.TOKEN_RADAR=${JSON.stringify(radar)};\n`;
}
