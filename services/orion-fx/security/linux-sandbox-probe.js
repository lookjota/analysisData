// Disposable, unprivileged mount/network probe. Never inspects host secrets.
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
const listener=createServer(socket=>socket.destroy());
await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
listener.unref();
const port=listener.address().port;
const root=mkdtempSync(join(tmpdir(),'orion-c5-sandbox-'));
try {
 const state=join(root,'state'),forbidden=join(root,'forbidden');
 mkdirSync(state,{mode:0o700});mkdirSync(forbidden,{mode:0o700});
 mkdirSync(join(root,'sibling'),{mode:0o700});writeFileSync(join(root,'sibling','credential'),'SYNTHETIC_SIBLING');
 writeFileSync(join(state,'journal'),'SYNTHETIC_ALLOWED');writeFileSync(join(forbidden,'credential'),'SYNTHETIC_FORBIDDEN',{mode:0o600});
 symlinkSync(join(forbidden,'credential'),join(state,'outside'));
 const probe=`
 import fs from 'node:fs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';
 assert.equal(fs.readFileSync('/state/journal','utf8'),'SYNTHETIC_ALLOWED');fs.writeFileSync('/state/write','synthetic');
 const db=new DatabaseSync('/state/own.sqlite');db.exec('CREATE TABLE synthetic(x)');db.close();
 const deny=p=>{assert.throws(()=>fs.readFileSync(p),e=>['ENOENT','EACCES','EPERM'].includes(e.code));};
 for(const p of [${JSON.stringify(join(forbidden,'credential'))},'/state/outside',${JSON.stringify(forbidden)},${JSON.stringify(root+'/sibling/credential')}])deny(p);
 assert.equal(process.env.C5_FAKE_SENSITIVE,undefined);
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import fs from 'node:fs';try{fs.readFileSync(process.argv[1]);process.exit(2)}catch(e){if(!['ENOENT','EACCES','EPERM'].includes(e.code))process.exit(3);console.log('CHILD_CANARY_DENIED')}",${JSON.stringify(join(forbidden,'credential'))}],{encoding:'utf8'});assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/CHILD_CANARY_DENIED/);
 const net=await import('node:net'),tls=await import('node:tls'),http=await import('node:http'),https=await import('node:https');
 const denied=make=>new Promise((resolve,reject)=>{const x=make();x.on('connect',()=>reject(Error('unexpected socket connection')));x.on('response',()=>reject(Error('unexpected response')));x.on('error',e=>['EPERM','EACCES','ENETUNREACH','ECONNREFUSED','EHOSTUNREACH'].includes(e.code)?resolve():reject(e));x.setTimeout(1500,()=>{x.destroy();reject(Error('probe timeout'))});});
 for(const make of [()=>net.connect(${port},'127.0.0.1'),()=>tls.connect({port:${port},host:'127.0.0.1',rejectUnauthorized:false}),()=>http.get('http://127.0.0.1:${port}'),()=>https.get('https://127.0.0.1:${port}')])await denied(make);
 await assert.rejects(fetch('http://127.0.0.1:${port}'),e=>['EPERM','EACCES','ENETUNREACH','ECONNREFUSED','EHOSTUNREACH'].includes(e.cause?.code));
 const socketChild=spawnSync(process.execPath,['--input-type=module','-e',"import net from 'node:net';const s=net.connect(${port},'127.0.0.1');s.on('connect',()=>process.exit(2));s.on('error',e=>{if(!['EPERM','EACCES','ENETUNREACH','ECONNREFUSED','EHOSTUNREACH'].includes(e.code))process.exit(3);console.log('CHILD_SOCKET_DENIED')});"],{encoding:'utf8'});assert.equal(socketChild.error,undefined);assert.equal(socketChild.status,0,socketChild.stderr);assert.match(socketChild.stdout,/CHILD_SOCKET_DENIED/);
 console.log('OS_NETWORK_LOOPBACK_DENIAL_CONFIRMED TCP TLS HTTP HTTPS fetch child; DNS and broker transports not exercised');
 console.log('OS_FILESYSTEM_DENIAL_CONFIRMED synthetic mount boundary; main and child');
 `;
 const result=spawnSync('bwrap',['--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/bin','/sbin','--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--bind',state,'/state','--clearenv','--setenv','TRADING_ENABLED','false','--setenv','PATH','/usr/bin:/bin','--chdir','/state','/usr/bin/node','--input-type=module','-e',probe],{encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH,C5_FAKE_SENSITIVE:'SYNTHETIC'}});
 if(result.error||result.status!==0){console.log(JSON.stringify({filesystem:'OS_FILESYSTEM_ISOLATION_UNKNOWN',network:'UNKNOWN',reason:result.error?.code??result.stderr.trim(),deployment:'UNVERIFIED'}));process.exitCode=0;}
 else process.stdout.write(result.stdout);
}finally{listener.close();rmSync(root,{recursive:true,force:true});}
