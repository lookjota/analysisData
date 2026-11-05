import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node.js >=22 required');process.exitCode=1; }
else console.log(`OK ${pkg.name} | Node ${process.version} | orders disabled`);
