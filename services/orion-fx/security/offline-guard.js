import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

// Process-lifetime tripwire. Install before importing the runtime. This is not
// a sandbox: native addons, subprocesses and previously captured APIs can bypass it.
export function installOfflineGuard() {
  const deny = () => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = net.Socket.prototype.connect = deny;
  tls.connect = deny;
  syncBuiltinESMExports();
}

// Defense in depth for the offline entry point, not a syscall sandbox. Native
// code, captured references, aliases and startup preloads remain outside it.
export async function installOfflineFileGuard() {
  const { default: fs } = await import('node:fs');
  const { default: promises } = await import('node:fs/promises');
  const { default: children } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const check = path => {
    if (typeof path === 'number') throw new Error('OFFLINE_RAW_DESCRIPTOR_FORBIDDEN');
    const text = path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path;
    if (typeof text !== 'string' || text.split(/[\\/]/).some(p => /^(?:\.env(?:\..*)?|\.aws|\.ssh)$/i.test(p))) throw new Error('OFFLINE_CREDENTIAL_ACCESS_FORBIDDEN');
  };
  for (const api of ['readFile','readFileSync','open','openSync','createReadStream']) {
    const original = fs[api];
    fs[api] = function(path, ...args) { check(path); return original.call(this, path, ...args); };
  }
  for (const api of ['readFile','open']) {
    const original = promises[api];
    promises[api] = function(path, ...args) { check(path); return original.call(this, path, ...args); };
  }
  process.loadEnvFile = () => { throw new Error('OFFLINE_CREDENTIAL_ACCESS_FORBIDDEN'); };
  const deny = () => { throw new Error('OFFLINE_CHILD_PROCESS_FORBIDDEN'); };
  for (const api of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) children[api] = deny;
  syncBuiltinESMExports();
}

export function restrictOfflineEnvironment() {
  // Explicit entry-point policy: never pass inherited credentials to runtime.
  const allowed = new Set(['PATH','LANG','LC_ALL','TZ','TERM']);
  for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
  process.env.TRADING_ENABLED = 'false';
}
