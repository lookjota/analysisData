import { installOfflineGuard } from '../security/offline-guard.js';
installOfflineGuard();
const { runForward } = await import('./forward.js');
process.exitCode = await runForward(process.argv.slice(2), { output: line => console.log(line), errorOutput: line => console.error(line) });
