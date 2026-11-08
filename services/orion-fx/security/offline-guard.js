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
