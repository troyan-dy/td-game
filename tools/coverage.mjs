import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const result = spawnSync(process.execPath, [
  'tools/slot.mjs', '--cpu', process.execPath,
  '--test', '--experimental-test-coverage',
  '--test-coverage-include=live/{config,mapgen,meta,rng,sim,wavegen}.js',
  '--test-coverage-lines=100',
  '--test-coverage-functions=100',
  '--test-coverage-branches=100',
  'tests/!(bot-runs|slot).test.mjs',
], { cwd: root, stdio: 'inherit' });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
