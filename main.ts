/** token-radar-01 entrypoint. Node 22 standard library only; no network access. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, chainDiversity, dataScript, filterByWatchlist, parseSnapshot, type BoardRow } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASHBOARD_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX_BYTES = 524_288;

type Scope = 'all' | 'watchlist' | 'early';
type Sort = 'rank' | 'value' | 'tvl' | 'growth' | 'name';

interface CliOptions {
  input: string;
  output: string;
  category: string | null;
  scope: Scope;
  limit: number;
  sort: Sort;
}

function argumentValue(args: string[], index: number, name: string): { value: string; consumed: number } {
  const current = args[index]!;
  const prefix = `--${name}=`;
  if (current.startsWith(prefix)) {
    const value = current.slice(prefix.length);
    if (value.length === 0) fail(`--${name} needs a value`);
    return { value, consumed: 1 };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
  return { value, consumed: 2 };
}

function parseCli(args: string[], environment: NodeJS.ProcessEnv): CliOptions {
  const values: CliOptions = {
    input: '/input',
    output: environment.MAKEFUN_OUTPUT_DIR ?? '/output',
    category: null,
    scope: 'all',
    limit: 10,
    sort: 'rank',
  };
  for (let index = 0; index < args.length;) {
    const argument = args[index]!;
    const name = argument.startsWith('--') ? argument.slice(2).split('=', 1)[0]! : '';
    if (!['input', 'output', 'category', 'scope', 'limit', 'sort'].includes(name)) fail(`unknown argument: ${argument}`);
    const parsed = argumentValue(args, index, name);
    if (name === 'input') values.input = parsed.value;
    if (name === 'output') values.output = parsed.value;
    if (name === 'category') values.category = parsed.value;
    if (name === 'scope') {
      if (!['all', 'watchlist', 'early'].includes(parsed.value)) fail('--scope must be all, watchlist, or early');
      values.scope = parsed.value as Scope;
    }
    if (name === 'limit') {
      const limit = Number(parsed.value);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('--limit must be a whole number from 1 to 100');
      values.limit = limit;
    }
    if (name === 'sort') {
      if (!['rank', 'value', 'tvl', 'growth', 'name'].includes(parsed.value)) fail('--sort must be rank, value, tvl, growth, or name');
      values.sort = parsed.value as Sort;
    }
    index += parsed.consumed;
  }
  return values;
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

function inputPath(selected: string): string {
  return selected.endsWith('.json') ? selected : join(selected, 'snapshot.json');
}

function reportRows(board: BoardRow[], watchlist: string[], options: CliOptions): BoardRow[] {
  let rows = filterByWatchlist(board, watchlist, options.scope);
  if (options.category !== null) {
    const category = options.category.toLocaleLowerCase('en-US');
    rows = rows.filter((row) => (row.category ?? 'Other').toLocaleLowerCase('en-US') === category);
  }
  const compare: Record<Sort, (a: BoardRow, b: BoardRow) => number> = {
    rank: (a, b) => a.rank - b.rank,
    value: (a, b) => b.implied_value_usd - a.implied_value_usd || a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd || a.rank - b.rank,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity) || a.rank - b.rank,
    name: (a, b) => a.name.localeCompare(b.name) || a.rank - b.rank,
  };
  return rows.sort(compare[options.sort]).slice(0, options.limit);
}

function summaryReport(board: BoardRow[], watchlist: string[], options: CliOptions): string {
  const rows = reportRows(board, watchlist, options);
  const category = options.category ?? 'all';
  const lines = [
    `token radar report: scope=${options.scope} category=${category} sort=${options.sort} limit=${options.limit}`,
    `token radar report: ${rows.length} shown; ${chainDiversity(rows)} unique chains represented`,
  ];
  rows.forEach((row, index) => {
    const growth = row.change_7d === null ? 'n/a' : `${row.change_7d.toFixed(2)}%`;
    lines.push(`  ${index + 1}. #${row.rank} ${row.name} | implied=$${row.implied_value_usd} | tvl=$${row.tvl_usd} | 7d=${growth}`);
  });
  if (rows.length === 0) lines.push('  No rows match report filters; complete board remains written unchanged.');
  return `${lines.join('\n')}\n`;
}

function copyDirectory(from: string, to: string, namePattern: RegExp): string[] {
  if (!existsSync(from)) fail(`required source directory is missing: ${from}`);
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    if (!namePattern.test(name)) fail(`${from}/${name} has an invalid file name`);
    const source = join(from, name);
    const info = statSync(source);
    if (!info.isFile()) fail(`${from}/${name} is not a regular file`);
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function validateScreenshots(directory: string, names: string[]): void {
  if (names.length !== 3) fail(`screenshots/ must contain exactly 3 images, found ${names.length}`);
  for (const name of names) {
    if (!/\.(png|jpe?g)$/i.test(name)) fail(`screenshots/${name} is not PNG or JPEG`);
    const bytes = statSync(join(directory, name)).size;
    if (bytes > SCREENSHOT_MAX_BYTES) fail(`screenshots/${name} is ${bytes} bytes, above ${SCREENSHOT_MAX_BYTES}`);
  }
}

const cli = parseCli(process.argv.slice(2), process.env);
const input = inputPath(cli.input);
if (!existsSync(input)) {
  process.stderr.write(`token radar: no snapshot at ${input}: pass --input <snapshot.json|directory> or mount /input\n`);
  process.exit(2);
}

const output = cli.output;
const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`model wrote a board the gate refuses: ${issue}`);

mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(output, 'data.js'), dataScript(radar));

const dashboardFiles = copyDirectory(join(ROOT, 'dashboard'), join(output, 'dashboard'), DASHBOARD_NAME);
if (!dashboardFiles.includes('index.html')) fail('dashboard has no index.html');
if (!dashboardFiles.some((name) => name.endsWith('.css'))) fail('dashboard has no CSS file');
if (!dashboardFiles.some((name) => name.endsWith('.js'))) fail('dashboard has no JavaScript file');

const screenshotDirectory = join(output, 'screenshots');
const screenshots = copyDirectory(join(ROOT, 'screenshots'), screenshotDirectory, IMAGE_NAME);
validateScreenshots(screenshotDirectory, screenshots);

const dossier = buildDossier(output, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: SCREENSHOT_MAX_BYTES },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(output, 'dossier.json'), dossier);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols; ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist covered; ${board.length} pre-token rows (${radar.early_size} early)\n` +
  `token radar: wrote board, offline dashboard (${dashboardFiles.length} files), ${screenshots.length} screenshots, and byte-exact dossier to ${output}\n` +
  summaryReport(board, snapshot.watchlist, cli),
);
