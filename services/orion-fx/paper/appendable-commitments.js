import { hash } from '../persistence/journal.js';
// Called only after inspectForwardJournal verifies the complete immutable file chain.
// This domain-separated overlay leaves the established observations.v1 bytes intact.
export function appendableCommitments(verified) {
  if(verified.integrity!=='VERIFIED_LOCAL_HASH_CHAIN' || verified.quarantinedSequences.length) throw new Error('UNVERIFIED_JOURNAL');
  const journalIdentity=hash({domain:'orion.appendable.journal.v1',genesis:verified.config.digest});
  const genesis=hash({domain:'orion.appendable.genesis.v1',journalIdentity,metadataDigest:verified.config.digest});
  let previous=genesis;
  const records=verified.records.map((r,i)=>{
    if(r.sequence!==i+1 || r.state!=='ACCEPTED')throw new Error('JOURNAL_SEQUENCE_GAP');
    const candleIdentity=hash({domain:'orion.appendable.candle.v1',timestamp:r.observation.candle.timestamp,contentHash:r.contentHash});
    const commitment=hash({domain:'orion.appendable.commitment.v1',previous,sequence:r.sequence,candleIdentity,observationDigest:r.digest});
    const result={sequence:r.sequence,previous,commitment,candleIdentity};previous=commitment;return result;
  });
  return {journalIdentity,genesis,records,head:previous};
}
