// main.ts — entrypoint the harness runs: node /bot/main.ts (Node 22+).
// Reads every case from /input/cases.json, answers each with run(), writes
// /output/answers.json. Deterministic, no network, exits 0 within 10 s.
import { setFlagsFromString } from 'node:v8';
setFlagsFromString('--no-incremental-marking');

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { run } = await import('./solve.js');

// The harness provides the input/output dirs via env vars; in the grader's
// container they are /input and /output.
const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const inputPath = `${inputDir}/cases.json`;
const outputPath = `${outputDir}/answers.json`;

const cases = JSON.parse(readFileSync(inputPath, 'utf8'));
const answers = [];
for (const c of cases) {
  answers.push(run(c.input));
}
mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(answers), { encoding: 'utf8', mode: 0o644 });
