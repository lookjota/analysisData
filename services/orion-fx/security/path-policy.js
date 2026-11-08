import { resolve } from 'node:path';

// Check lexical components BEFORE normalization or opening any descriptor.
export function evidencePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\')) throw new Error('UNSAFE_PATH');
  const parts = path.split('/');
  if (parts.includes('..')) throw new Error('PATH_TRAVERSAL_FORBIDDEN');
  if (parts.some(p => /^(?:\.env(?:\..*)?|\.aws|\.ssh|\.git|freqtrade)$/i.test(p) || /holdout/i.test(p))) throw new Error('UNSAFE_PROTECTED_PATH_FORBIDDEN');
  return resolve(path);
}
