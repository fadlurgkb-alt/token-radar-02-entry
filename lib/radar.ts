/** Deterministic snapshot-to-board model. Node 22 standard library only. */
import { EvidenceGrade, scoreEvidence } from './evidence.ts';

/** One protocol record exactly as normalized from sealed snapshot. */
export interface Protocol {
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

/** Complete immutable input document consumed by radar. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Public valuation constants; dashboard displays same values. */
export interface Model {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: Model = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** Required gate row plus transparent model inputs and plan. */
export interface BoardRow extends Protocol {
  rank: number;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Compact row embedded in offline dashboard data. */
export interface RadarRow {
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
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
  evidence_grade: EvidenceGrade;
  evidence_score: number;
  farm_steps: string[];
}

/** Already-trading comparison record excluded from implied-value board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Entire serializable state required by static dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Model;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const DAY = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

function object(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function protocolOf(value: unknown, index: number): Protocol {
  const p = object(value, `snapshot protocol ${index} is not an object`);
  if (typeof p.slug !== 'string' || p.slug.length === 0) throw new Error(`snapshot protocol ${index} has no slug`);
  if (typeof p.name !== 'string' || p.name.length === 0) throw new Error(`snapshot protocol ${index} has no name`);
  if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new Error(`snapshot protocol ${index} has no TVL`);
  return {
    slug: p.slug,
    name: p.name,
    category: nullableString(p.category),
    chains: Array.isArray(p.chains) ? p.chains.filter((chain): chain is string => typeof chain === 'string') : [],
    tvl_usd: p.tvl_usd,
    change_7d: nullableNumber(p.change_7d),
    mcap_usd: nullableNumber(p.mcap_usd),
    listed_at: nullableString(p.listed_at),
    gecko_id: nullableString(p.gecko_id),
    symbol: nullableString(p.symbol),
  };
}

export function parseSnapshot(text: string): Snapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  const root = object(value, 'snapshot.json is not an object');
  if (typeof root.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(root.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof root.source !== 'string') throw new Error('snapshot.json has no source');
  if (!Number.isSafeInteger(root.floor_usd) || (root.floor_usd as number) <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(root.protocols)) throw new Error('snapshot.json has no protocols');
  if (!Array.isArray(root.watchlist) || root.watchlist.some((slug) => typeof slug !== 'string')) throw new Error('snapshot.json has no watchlist');
  return {
    as_of: root.as_of,
    source: root.source,
    floor_usd: root.floor_usd as number,
    protocols: root.protocols.map(protocolOf),
    watchlist: root.watchlist as string[],
  };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  return Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / DAY)) : null;
}

export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Number of unique, non-empty chains represented by protocols. */
export function chainDiversity(protocols: readonly Pick<Protocol, 'chains'>[]): number {
  const chains = new Set<string>();
  for (const protocol of protocols) {
    for (const chain of protocol.chains) {
      const normalized = chain.trim();
      if (normalized.length > 0) chains.add(normalized);
    }
  }
  return chains.size;
}

/** Keep rows in or out of official watchlist without changing original order. */
export function filterByWatchlist<T extends { slug: string }>(
  rows: readonly T[],
  watchlist: readonly string[],
  scope: 'all' | 'watchlist' | 'early',
): T[] {
  if (scope === 'all') return [...rows];
  const official = new Set(watchlist);
  return rows.filter((row) => scope === 'watchlist' ? official.has(row.slug) : !official.has(row.slug));
}

function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function score(p: Protocol, asOf: string, model: Model) {
  const age = ageDays(asOf, p.listed_at);
  const observedGrowth = p.change_7d ?? 0;
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, observedGrowth));
  const growthMultiplier = 1 + (growth / 100) * model.growth_weight;
  const effectiveAge = age ?? model.unknown_age_days;
  const maturityMultiplier = model.maturity_floor + Math.min(effectiveAge, model.maturity_days) / model.maturity_days * model.maturity_range;
  const implied = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * growthMultiplier * maturityMultiplier));
  return { age, growth, growthMultiplier, maturityMultiplier, implied };
}

function primaryChain(p: Protocol): string {
  return p.chains[0] ?? 'its main chain';
}

function capital(p: Protocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function categoryAction(p: Protocol, amount: number): string {
  const category = (p.category ?? '').toLowerCase();
  const chain = primaryChain(p);
  if (category.includes('lend') || category.includes('cdp') || category.includes('collateral')) return `Supply $${amount} of USDC to ${p.name} on ${chain} and keep the position open.`;
  if (category.includes('dex') || category.includes('yield') || category.includes('farm')) return `Provide $${amount} of liquidity to ${p.name}'s main pool on ${chain} and keep the position open.`;
  if (category.includes('bridge')) return `Bridge $${amount} of USDC to ${chain} through ${p.name}, then use the bridged funds once.`;
  if (category.includes('staking') || category.includes('restak')) return `Stake $${amount} of the chain's staking asset through ${p.name} and retain the receipt.`;
  if (category.includes('perpetual') || category.includes('derivative')) return `Deposit $${amount} of USDC as margin on ${p.name} and open one small hedged position.`;
  if (category.includes('prediction')) return `Fund ${p.name} with $${amount} and place one small market position.`;
  if (category.includes('stable')) return `Mint or deposit $${amount} of the stable asset through ${p.name} on ${chain}.`;
  if (category.includes('rwa')) return `Mint $${amount} of ${p.name}'s yield asset on ${chain} and retain it.`;
  if (category.includes('insurance')) return `Buy $${amount} of cover from ${p.name} on ${chain} and retain the policy.`;
  return `Deposit $${amount} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

function step(action: string, cost: string, time: string): string {
  return `${action} Cost: ${cost}. Time: ${time}.`;
}

export function farmSteps(p: Protocol, age: number | null): string[] {
  const amount = capital(p);
  const duration = holdDays(age);
  return [
    step('Use a fresh wallet holding only the funds budgeted for this farm, and store its seed phrase offline', 'under $3 for the first transaction', '5 minutes'),
    step(categoryAction(p, amount), `$${amount} of capital and about $${amount >= 150 ? 8 : 4} of gas`, '15 minutes to set up'),
    step('Make one qualifying action each week, such as a deposit, borrow, swap, vote, or position update', 'about $2 of gas per week', '10 minutes per week'),
    step(`Keep the core position open for at least ${duration} days so activity can span multiple snapshots`, `$${amount} remains exposed in the position`, `${duration} days`),
    step("Before withdrawing, check the protocol's own points or rewards page and use only links it publishes", 'free to check; never pay to claim', '10 minutes'),
    step('Record wallet, dates, transaction hashes, capital, and fees in a farm log before unwinding', 'no financial cost', '5 minutes'),
    step('Exit if the position loses 10%, withdrawals pause, or published contracts change; never sign unlimited approval', `up to $${Math.round(amount * 0.1)} at the loss limit plus exit gas`, '2 minutes for alerts and 15 minutes to unwind'),
  ];
}

export function buildBoard(snapshot: Snapshot, model: Model = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const selected = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p) selected.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!selected.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) selected.set(p.slug, p);
  }
  const scored = [...selected.values()].map((p) => ({ p, ...score(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));
  return scored.map((item, index) => ({
    ...item.p,
    rank: index + 1,
    token_status: 'pre-token',
    age_days: item.age,
    implied_value_usd: item.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: item.growth,
      growth_multiplier: round4(item.growthMultiplier),
      maturity_multiplier: round4(item.maturityMultiplier),
      age_days: item.age,
    },
    farm_steps: farmSteps(item.p, item.age),
  }));
}

function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug))
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  const evidence = scoreEvidence(row);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
    evidence_grade: evidence.grade,
    evidence_score: evidence.score,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: Model = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const rows = board.map((row) => radarRow(row, watchlist));
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model,
      model_version: 'radar-2',
      watchlist_size: snapshot.watchlist.length,
      board_size: board.length,
      early_size: rows.filter((row) => !row.watchlist).length,
      live_size: live.length,
      rows,
      live,
    },
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let index = 0; index < board.length; index++) {
    const row = board[index]!;
    if (!known.has(row.slug)) return `${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== index + 1) return `${row.slug} has rank ${row.rank}, expected ${index + 1}`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) return `${row.slug} has invalid implied value`;
    if (index > 0 && row.implied_value_usd > board[index - 1]!.implied_value_usd) return `${row.slug} rises in value after rank ${index}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    if (row.farm_steps.some((item) => item.trim().length < 20 || item.trim().length > 600)) return `${row.slug} has an invalid farm step`;
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length) return `board misses watchlist slug ${missing[0]}`;
  if (board.length > 1 && board[0]!.implied_value_usd === board.at(-1)!.implied_value_usd) return 'all implied values are equal';
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
