// Every place that carries the version must agree, and a release tag must name that version:
// otherwise two different builds would ship under one number. Run by CI on every push and release.
//
//   node scripts/check-version.mjs            check the files
//   node scripts/check-version.mjs v0.2.0     also check a release tag

import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const cargoVersion = (path) => /^version\s*=\s*"([^"]+)"/m.exec(read(path))?.[1];

const found = {
  'app/package.json': JSON.parse(read('app/package.json')).version,
  'app/package-lock.json': JSON.parse(read('app/package-lock.json')).version,
  'app/src-tauri/tauri.conf.json': JSON.parse(read('app/src-tauri/tauri.conf.json')).version,
  'app/src-tauri/Cargo.toml': cargoVersion('app/src-tauri/Cargo.toml'),
  'crates/herplan-storage/Cargo.toml': cargoVersion('crates/herplan-storage/Cargo.toml'),
};
const version = found['app/package.json'];
const problems = Object.entries(found)
  .filter(([, v]) => v !== version)
  .map(([file, v]) => `${file} has ${v ?? 'no version'}, app/package.json has ${version}`);

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) problems.push(`"${version}" is not MAJOR.MINOR.PATCH`);

const tag = process.argv[2];
if (tag && tag !== `v${version}`) {
  problems.push(
    `release tag ${tag} does not match the app version ${version}: name the release v${version}, ` +
      `or bump the version in the files above first`,
  );
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`✓ version ${version}${tag ? `, tag ${tag}` : ''}`);
