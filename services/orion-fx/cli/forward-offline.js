import { installOfflineGuard, installOfflineFileGuard, restrictOfflineEnvironment } from '../security/offline-guard.js';
installOfflineGuard();
restrictOfflineEnvironment();
await installOfflineFileGuard();
const { runForward } = await import('./forward.js');
process.exitCode = await runForward(process.argv.slice(2), { output: line => console.log(line), errorOutput: line => console.error(line) });
