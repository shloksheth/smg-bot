import test from 'node:test';
import assert from 'node:assert/strict';
import {SMG} from '../src/smg.js';
test('rejected login is classified without returning credentials or page text',async()=>{
 const doc={body:{innerText:'Invalid Team ID or password'},querySelector:()=>({})};
 const scoped=fn=>{const old=globalThis.document;globalThis.document=doc;try{return fn();}finally{globalThis.document=old;}};
 const page={waitForSelector:async()=>{},type:async()=>{},waitForFunction:async fn=>{assert.equal(scoped(fn),true);},evaluate:async fn=>scoped(fn)};
 const smg=new SMG(page,Date.now()+10000);smg.goto=async()=>{};smg.clickText=async()=>{};smg.guard=async()=>{};
 await assert.rejects(smg.login('private-username','private-password'),/Game rejected login credentials/);
 assert.equal(smg.loginDiagnostics.credentialsRejected,true);
 assert.ok(!JSON.stringify(smg.loginDiagnostics).includes('private-'));
});
