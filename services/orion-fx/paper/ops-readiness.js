import { inspectForwardJournal } from '../market-data/forward-journal.js';
import { processAppendableJournal } from './appendable-operations.js';
import { verifyAcquisitionReceipt } from '../market-data/acquisition-receipt.js';
import { readStoredJson } from '../market-data/capital-history.js';

export async function assessOpsReadiness({ directory, runId, receipt, clock }) {
  const base = { schemaVersion: 'orion.ops-readiness.v1', tradingEnabled: false, brokerExecution: 'DISABLED', executableQuoteAvailable: false };
  try {
    const journal = await inspectForwardJournal(directory, clock);
    const paper = await processAppendableJournal({ directory, runId, action: 'status', clock });
    const source = receipt ? verifyAcquisitionReceipt(await readStoredJson(receipt)) : null;
    const reconciled = paper.accounts.length === 4 && paper.accounts.every(a => a.financialReconciliation === 'VERIFIED' && a.cursor?.sequence === journal.sequence && a.currentRiskState === 'ACTIVE') && paper.synchronized;
    // Existing receipts are engineering fixtures. No implemented source can pass
    // the independent forward provenance or executable-price gates.
    return { ...base, classification: 'FORWARD_OBSERVATION_BLOCKED', engineeringAssessment: reconciled ? 'ENGINEERING_READY' : 'UNKNOWN', journalIntegrity: journal.integrity, receiptIntegrity: source?.integrity ?? 'MISSING', receiptJournalBinding: 'UNVERIFIED', sourceAuthentication: journal.sourceAuthentication, freshness: journal.inputFreshness, accountEvidence: paper.accounts.map(a => ({ strategyId: a.strategyId, sessionId: a.sessionId, status: a.status, cursor: a.cursor ?? null, riskState: a.currentRiskState, financialReconciliation: a.financialReconciliation })), blockers: ['NO_AUTHENTICATED_FORWARD_SOURCE', 'NO_EXECUTABLE_QUOTE', ...(!source ? ['MISSING_RECEIPT'] : []), ...(!reconciled ? ['ACCOUNT_EVIDENCE_INCOMPLETE_OR_BLOCKED'] : [])], executionPrice: 'HISTORICAL_H1_NEXT_OPEN_MODEL_ONLY' };
  } catch {
    return { ...base, classification: 'UNKNOWN', engineeringAssessment: 'UNKNOWN', blockers: ['EVIDENCE_MISSING_OR_INVALID'] };
  }
}
