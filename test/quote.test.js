import test from 'node:test';
import assert from 'node:assert/strict';
import {SMG} from '../src/smg.js';

test('quote reads direct value cell instead of nested last-child label',async()=>{
 const row=(label,value)=>({querySelector:selector=>({textContent:label}),lastElementChild:{tagName:'P',textContent:value}});
 const rows=[row('Last SMG Price (10/02/2026):','$769.6400'),row('Close Price (10/01/2026):','$763.9900'),row('Market Cap (millions):','817799.34')];
 const page={waitForFunction:async(fn,options,date)=>{
  assert.equal(options.timeout,8000);
  const original=globalThis.document;
  let label='Last SMG Price (10/01/2026):';
  globalThis.document={querySelectorAll:()=>[{querySelector:()=>({textContent:label})}]};
  try {assert.equal(Boolean(fn(date)),false);label='Last SMG Price (10/02/2026):';assert.equal(Boolean(fn(date)),true);} finally {globalThis.document=original;}
 },evaluate:async fn=>{
  const original=globalThis.document;
  globalThis.document={querySelectorAll:selector=>{assert.equal(selector,'.stock-sub-row');return rows;}};
  try{return fn();}finally{globalThis.document=original;}
 }};
 const smg=new SMG(page,Date.now()+10000);smg.selectStock=async()=>{smg.quoteDiagnostics={};};
 assert.deepEqual(await smg.quote('SPY','2026-10-02'),{price:769.64,previous:763.99,date:'2026-10-02',marketCap:817799340000});
});
