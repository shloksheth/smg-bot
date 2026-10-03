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
for(const verified of [true,false])test(`late login requires verified account identity: ${verified}`,async()=>{
 const doc={body:{innerText:`Trade Type: ENDOFDAY ${verified?'private-username':'another-account'}`},querySelector:()=>({})};
 const scoped=(fn,arg)=>{const old=globalThis.document;globalThis.document=doc;try{return fn(arg);}finally{globalThis.document=old;}};
 const timeout=Object.assign(new Error('Waiting failed: timeout exceeded'),{name:'TimeoutError'});
 const page={waitForSelector:async()=>{},type:async()=>{},waitForFunction:async()=>{throw timeout;},evaluate:async(fn,arg)=>scoped(fn,arg)};
 const smg=new SMG(page,Date.now()+10000);smg.goto=async()=>{};smg.clickText=async()=>{};smg.guard=async()=>{};
 if(verified)await smg.login('private-username','private-password');
 else await assert.rejects(smg.login('private-username','private-password'),{name:'TimeoutError'});
 assert.equal(smg.loginDiagnostics.accountIdentityVerified,verified);
 assert.ok(!JSON.stringify(smg.loginDiagnostics).includes('private-'));
});
