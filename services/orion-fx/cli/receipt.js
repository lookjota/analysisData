import { readStoredJson } from '../market-data/capital-history.js';
import { verifyAcquisitionReceipt, appendReceiptObservations } from '../market-data/acquisition-receipt.js';

export const receiptCommands = ['receipt:verify', 'receipt:coverage', 'receipt:append'];
export async function runReceipt(args, { output, errorOutput }) {
  try {
    if (!receiptCommands.includes(args[0])) throw new Error('INVALID_ARGUMENTS');
    if (args.length === 2 && args[1] === '--help') {
      output('Offline receipt:verify|receipt:coverage --input RECEIPT.json; receipt:append --input RECEIPT.json --journal EXISTING_DIRECTORY. Engineering fixtures only; no forward promotion or network activation.');
      return 0;
    }
    const flags = {};
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i]?.slice(2);
      if (!args[i]?.startsWith('--') || !['input', 'journal'].includes(key) || Object.hasOwn(flags, key) || !args[i + 1]) throw new Error('INVALID_ARGUMENTS');
      flags[key] = args[i + 1];
    }
    const append = args[0] === 'receipt:append';
    if (!flags.input?.endsWith('.json') || append !== Boolean(flags.journal)) throw new Error('INVALID_ARGUMENTS');
    const receipt = await readStoredJson(flags.input);
    const verified = verifyAcquisitionReceipt(receipt);
    if (append) {
      const state = await appendReceiptObservations(flags.journal, receipt);
      output(JSON.stringify({ ...verified, sequence: state.sequence, head: state.head, quarantinedSequences: state.quarantinedSequences }));
    } else output(JSON.stringify(verified));
    return 0;
  } catch {
    errorOutput(JSON.stringify({ error: 'RECEIPT_COMMAND_FAILED', tradingEnabled: false, brokerExecution: 'DISABLED' }));
    return 1;
  }
}
