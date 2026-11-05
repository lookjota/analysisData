import http from 'node:http';
import { evaluateOrder } from './risk.js';
const port = Number(process.env.PORT || 8787);
// Bind loopback by default. Docker maps container port onto host loopback only.
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200); response.end(JSON.stringify({status:'ok',project:'orion',mode:'foundation',execution:'disabled'})); return;
  }
  if (request.method === 'GET' && request.url === '/capabilities') {
    response.writeHead(200);response.end(JSON.stringify({providers:['freqtrade','hummingbot','mt5'], connectedProviders:[], modes:['paper','demo'], canTrade:false}));return;
  }
  if (request.url === '/orders' || request.url?.startsWith('/orders?')) {
    response.writeHead(403);response.end(JSON.stringify(evaluateOrder({},{mode:'paper'})));return;
  }
  response.writeHead(404); response.end(JSON.stringify({error:'not_found'}));
});
server.listen(port,host,()=>console.log(`Orion Foundation listening at http://${host}:${port}`));
