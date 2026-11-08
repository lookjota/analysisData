import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fork} from 'node:child_process';
import {once} from 'node:events';
const [allowed,forbidden,mode]=process.argv.slice(2);
if(mode==='nested'){
 if(fs.readFileSync(forbidden+'/credential','utf8')!=='SYNTHETIC_ONLY')throw Error('BAD_CANARY');
 process.send({nested:true});
}else{
 if(fs.readFileSync(allowed+'/journal','utf8')!=='SYNTHETIC_JOURNAL')throw Error('BAD_JOURNAL');
 fs.writeFileSync(allowed+'/state','synthetic');const db=new DatabaseSync(allowed+'/own.sqlite');db.exec('CREATE TABLE synthetic(x)');db.close();
 for(const p of [forbidden+'/credential',allowed+'/alias'])if(fs.readFileSync(p,'utf8')!=='SYNTHETIC_ONLY')throw Error('BAD_CANARY');
 const child=fork(new URL('./c5-canary-worker.js',import.meta.url),[allowed,forbidden,'nested'],{stdio:['ignore','ignore','ignore','ipc']});
 const exited=once(child,'exit');const [message]=await once(child,'message');if(!message.nested)throw Error('NO_NESTED_EVIDENCE');if((await exited)[0]!==0)throw Error('NESTED_FAILED');
 process.send({sameUidCanRead:true});
}
process.disconnect();
