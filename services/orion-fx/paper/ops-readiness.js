import { inspectForwardJournal } from '../market-data/forward-journal.js';
import { processAppendableJournal } from './appendable-operations.js';
import { verifyAcquisitionReceipt } from '../market-data/acquisition-receipt.js';
import { readStoredJson } from '../market-data/capital-history.js';

const gateNames = ['offlinePersistenceSecurity','journalIntegrity','accountIdentity','cursorLedgerAtomicity',
  'financialReconciliation','riskEligibility','cursorSynchronization','freshness','sourceAuthenticity',
  'completedCandleSourceVerification','receiptJournalBinding','executionPrice','credentialIsolation','networkIsolation','brokerOrderProhibition'];
function summarize(gates) {
  return { gates, failedGates: Object.keys(gates).filter(k=>gates[k]==='FAIL'), unknownGates: Object.keys(gates).filter(k=>gates[k]==='UNKNOWN') };
}
export async function assessOpsReadiness({ directory, runId, receipt, clock }) {
  const base = { schemaVersion: 'orion.ops-readiness.v1', tradingEnabled: false, brokerExecution: 'DISABLED', executableQuoteAvailable: false };
  try {
    const journal = await inspectForwardJournal(directory, clock);
    const paper = await processAppendableJournal({ directory, runId, action: 'status', clock });
    const source = receipt ? verifyAcquisitionReceipt(await readStoredJson(receipt)) : null;
    const complete = paper.accounts.length === 4;
    const financial = complete && paper.accounts.every(a=>a.financialReconciliation==='VERIFIED');
    const active = complete && paper.accounts.every(a=>a.currentRiskState==='ACTIVE');
    const reconciled = financial && active && paper.synchronized;
    const gates = {
      offlinePersistenceSecurity: 'UNKNOWN', journalIntegrity: 'PASS',
      accountIdentity: complete && paper.accounts.every(a=>a.configurationHash) ? 'PASS' : 'UNKNOWN',
      cursorLedgerAtomicity: financial ? 'PASS' : 'UNKNOWN', financialReconciliation: financial ? 'PASS' : 'UNKNOWN',
      riskEligibility: active ? 'PASS' : paper.accounts.some(a=>['HALTED','PAUSED'].includes(a.currentRiskState)) ? 'FAIL' : 'UNKNOWN',
      cursorSynchronization: financial ? (paper.synchronized ? 'PASS' : 'FAIL') : 'UNKNOWN',
      freshness: journal.inputFreshness.stale ? 'FAIL' : 'PASS', sourceAuthenticity: 'FAIL',
      completedCandleSourceVerification: 'UNKNOWN', receiptJournalBinding: 'UNKNOWN', executionPrice: 'FAIL',
      credentialIsolation: 'UNKNOWN', networkIsolation: 'UNKNOWN', brokerOrderProhibition: 'PASS',
    };
    // Local hashes and engineering fixtures cannot satisfy forward provenance.
    // OS isolation is never inferred from successful JavaScript guard tests.
    return { ...base, ...summarize(gates), classification: 'FORWARD_OBSERVATION_BLOCKED',
      engineeringAssessment: reconciled ? 'ENGINEERING_READY' : 'UNKNOWN',
      journalIntegrity: journal.integrity, receiptIntegrity: source?.integrity ?? 'MISSING', receiptJournalBinding: 'UNVERIFIED',
      sourceAuthentication: journal.sourceAuthentication, freshness: journal.inputFreshness,
      accountEvidence: paper.accounts.map(a=>({strategyId:a.strategyId,sessionId:a.sessionId,status:a.status,cursor:a.cursor??null,riskState:a.currentRiskState,financialReconciliation:a.financialReconciliation})),
      blockers: ['NO_AUTHENTICATED_FORWARD_SOURCE','NO_EXECUTABLE_QUOTE',...(!source?['MISSING_RECEIPT']:[]),...(!reconciled?['ACCOUNT_EVIDENCE_INCOMPLETE_OR_BLOCKED']:[])],
      executionPrice: 'HISTORICAL_H1_NEXT_OPEN_MODEL_ONLY' };
  } catch {
    const gates=Object.fromEntries(gateNames.map(name=>[name,name==='brokerOrderProhibition'?'PASS':'UNKNOWN']));
    return {...base,...summarize(gates),classification:'UNKNOWN',engineeringAssessment:'UNKNOWN',blockers:['EVIDENCE_MISSING_OR_INVALID']};
  }
}
