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
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASHBOARD_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_MAX_BYTES = 524_288;

function option(name: string): string | undefined {
  const separate = process.argv.indexOf(`--${name}`);
  if (separate >= 0 && separate + 1 < process.argv.length) return process.argv[separate + 1];
  const prefix = `--${name}=`;
  const combined = process.argv.find((item) => item.startsWith(prefix));
  return combined?.slice(prefix.length);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

function inputPath(): string {
  const selected = option('input') ?? '/input';
  return selected.endsWith('.json') ? selected : join(selected, 'snapshot.json');
}

function outputPath(): string {
  return option('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
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

const input = inputPath();
if (!existsSync(input)) {
  process.stderr.write(`token radar: no snapshot at ${input}: pass --input <snapshot.json|directory> or mount /input\n`);
  process.exit(2);
}

const output = outputPath();
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
  `token radar: wrote board, offline dashboard (${dashboardFiles.length} files), ${screenshots.length} screenshots, and byte-exact dossier to ${output}\n`,
);
