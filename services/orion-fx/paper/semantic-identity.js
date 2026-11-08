import { readdir, readFile } from 'node:fs/promises';
import { hash } from '../persistence/journal.js';
// Conservative code identity: any change in these execution dependencies requires a new run.
export async function semanticIdentity() {
  const files = [];
  for (const directory of ['backtesting','strategies','risk','financial','portfolio','execution','calendar','market-data','persistence','paper','indicators']) {
    for (const name of (await readdir(new URL(`../${directory}/`,import.meta.url))).sort()) {
      if (name.endsWith('.js')) files.push([`${directory}/${name}`,hash(await readFile(new URL(`../${directory}/${name}`,import.meta.url),'utf8'))]);
    }
  }
  return hash({domain:'orion.appendable.semantic.v1',files});
}
