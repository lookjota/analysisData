import { collectOfflineReceipt, saveAcquisitionReceipt, appendReceiptObservations } from '../../market-data/acquisition-receipt.js';
import { offlineTransport, fixtureEnv, from, to, asOf } from './acquisition-offline.js';
const [phase, path, directory] = process.argv.slice(2);
const receipt = await collectOfflineReceipt({ env: fixtureEnv, ...offlineTransport(), from, to, asOf });
if (phase !== 'before-publication') await saveAcquisitionReceipt(path, receipt);
if (phase === 'after-append') await appendReceiptObservations(directory, receipt, () => asOf);
process.send(phase);
setInterval(() => {}, 1000);
