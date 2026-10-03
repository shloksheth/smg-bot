import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteD1} from '../runner/d1.js';
test('remote D1 binds parameters separately and exposes durable claim metadata',async()=>{
 const db=new RemoteD1('a'.repeat(32),'26a1eedc-126a-440e-b356-1e887eafbe9c','test-only-token',async(url,options)=>{
  assert.equal(new URL(url).host,'api.cloudflare.com');
  assert.deepEqual(JSON.parse(options.body),{sql:'INSERT INTO test VALUES (?,?)',params:['3',"quote' here"]});
  return {ok:true,json:async()=>({success:true,result:[{success:true,meta:{changes:1},results:[{value:'true'}]}]})};
 });
 const statement=db.prepare('INSERT INTO test VALUES (?,?)').bind(3,"quote' here");
 assert.equal((await statement.run()).meta.changes,1);assert.equal(await statement.first('value'),'true');
});
test('D1 failures never expose response messages or token',async()=>{
 const db=new RemoteD1('a'.repeat(32),'26a1eedc-126a-440e-b356-1e887eafbe9c','secret',async()=>({ok:true,json:async()=>({success:false,errors:[{message:'private-data'}]})}));
 await assert.rejects(db.prepare('SELECT 1').all(),error=>error.message==='D1 query failed');
});
