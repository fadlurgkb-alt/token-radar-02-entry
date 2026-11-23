/**
 * Typed enum object for evidence quality. A const object is used instead of a
 * TypeScript `enum` because Node 22 strip-only execution cannot transform
 * runtime enum syntax without a compiler.
 */
export const EvidenceGrade = {
  A: 'A',
  B: 'B',
  C: 'C',
} as const;

export type EvidenceGrade = typeof EvidenceGrade[keyof typeof EvidenceGrade];

/** Snapshot fields used as evidence. No source beyond sealed input is claimed. */
export const EvidenceSource = {
  Tvl: 'tvl_usd',
  SevenDayGrowth: 'change_7d',
  ListingDate: 'listed_at',
  TokenMarketCap: 'mcap_usd',
  CoinGeckoId: 'gecko_id',
  TokenSymbol: 'symbol',
  Chains: 'chains',
  Watchlist: 'watchlist',
} as const;

export type EvidenceSource = typeof EvidenceSource[keyof typeof EvidenceSource];

/** Minimal shape needed to score evidence independently from radar model. */
export interface EvidenceInput {
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  mcap_usd: number | null;
  gecko_id: string | null;
  symbol: string | null;
  chains: string[];
}

/** Transparent evidence result carried into dashboard rows and reports. */
export interface EvidenceAssessment {
  grade: EvidenceGrade;
  score: number;
  observed: EvidenceSource[];
  missing: EvidenceSource[];
  note: string;
}

const CORE_SOURCES = [
  EvidenceSource.Tvl,
  EvidenceSource.SevenDayGrowth,
  EvidenceSource.ListingDate,
  EvidenceSource.Chains,
] as const;

/**
 * Score only fields present in sealed snapshot.
 * TVL is mandatory in valid input and contributes 40 points. Growth and age
 * contribute 25 each; at least one named chain contributes 10. Grade A means
 * 90-100, B means 65-89, and C means less than 65.
 */
export function scoreEvidence(input: EvidenceInput): EvidenceAssessment {
  const observed: EvidenceSource[] = [];
  const missing: EvidenceSource[] = [];
  let score = 0;

  if (Number.isFinite(input.tvl_usd) && input.tvl_usd > 0) {
    score += 40;
    observed.push(EvidenceSource.Tvl);
  } else {
    missing.push(EvidenceSource.Tvl);
  }

  if (input.change_7d !== null && Number.isFinite(input.change_7d)) {
    score += 25;
    observed.push(EvidenceSource.SevenDayGrowth);
  } else {
    missing.push(EvidenceSource.SevenDayGrowth);
  }

  if (input.listed_at !== null && /^\d{4}-\d{2}-\d{2}$/.test(input.listed_at)) {
    score += 25;
    observed.push(EvidenceSource.ListingDate);
  } else {
    missing.push(EvidenceSource.ListingDate);
  }

  if (input.chains.length > 0) {
    score += 10;
    observed.push(EvidenceSource.Chains);
  } else {
    missing.push(EvidenceSource.Chains);
  }

  const grade = score >= 90 ? EvidenceGrade.A : score >= 65 ? EvidenceGrade.B : EvidenceGrade.C;
  const absentCore = CORE_SOURCES.filter((source) => missing.includes(source));
  const note = absentCore.length === 0
    ? 'TVL, seven-day growth, listing date, and chain coverage are observed.'
    : `Missing snapshot evidence: ${absentCore.join(', ')}.`;

  return { grade, score, observed, missing, note };
}

/** Token-record fields supporting pre-token classification, kept separate from value evidence. */
export function tokenRecordSources(input: EvidenceInput): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  if (input.mcap_usd !== null) sources.push(EvidenceSource.TokenMarketCap);
  if (input.gecko_id !== null) sources.push(EvidenceSource.CoinGeckoId);
  if (input.symbol !== null) sources.push(EvidenceSource.TokenSymbol);
  return sources;
}
