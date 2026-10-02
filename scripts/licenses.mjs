import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const found = new Map();
for (const [path, pin] of Object.entries(lock.packages)) {
  if (!path || pin.dev) continue;
  const pkg = JSON.parse(readFileSync(path + '/package.json', 'utf8'));
  if (!['MIT', 'ISC', 'BSD-3-Clause'].includes(pkg.license))
    throw new Error('Review new license: ' + pkg.name + ' ' + pkg.license);
  const key = pkg.name + '@' + pkg.version;
  if (found.has(key)) continue;
  const license = readdirSync(path).find((p) => /^licen[sc]e(?:\..*)?$/i.test(p));
  if (!license) throw new Error('No license notice: ' + key);
  found.set(key, { license: pkg.license, text: readFileSync(path + '/' + license, 'utf8') });
}
let output =
  'SelfLib 0.1.0 runtime dependency notices\nGenerated from package-lock.json and installed package licenses by node scripts/licenses.mjs.\nKeep these notices with redistributed software. Node/Debian base-image components retain their own notices.\n';
for (const [name, pkg] of [...found].sort(([a], [b]) => a.localeCompare(b)))
  output +=
    '\n' +
    '='.repeat(72) +
    '\n' +
    name +
    ' (' +
    pkg.license +
    ')\n' +
    '='.repeat(72) +
    '\n' +
    pkg.text.trim() +
    '\n';
writeFileSync('docs/dependency-licenses.txt', output);
console.log('Recorded ' + found.size + ' runtime dependency license notices.');
