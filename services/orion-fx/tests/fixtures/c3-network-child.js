import { installOfflineGuard } from '../../security/offline-guard.js';
installOfflineGuard();
const { request: http } = await import('node:http');
const { request: https } = await import('node:https');
const { connect: tcp, Socket } = await import('node:net');
const { connect: tls } = await import('node:tls');
for (const attempt of [() => fetch('https://example.invalid'), () => http('http://example.invalid'), () => https('https://example.invalid'), () => tcp(443, 'example.invalid'), () => new Socket().connect(443, 'example.invalid'), () => tls(443, 'example.invalid')]) {
  try { attempt(); process.exit(1); } catch (error) { if (error.message !== 'OFFLINE_NETWORK_FORBIDDEN') process.exit(2); }
}
