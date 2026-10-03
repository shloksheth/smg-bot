import test from 'node:test';
import assert from 'node:assert/strict';
import {SMG} from '../src/smg.js';
test('summary waits for all cards and both totals, including negative buying power',async()=>{
 const labels=['Total Equity','Buying Power','Cash Balance'],values=['$96,432.76','$-54.91','$-11,807.46'];
 const divs=labels.map((label,i)=>({children:[],textContent:label,parentElement:{parentElement:{parentElement:{querySelector:()=>({textContent:values[i]})}}}}));
 const rows=[{children:[{textContent:'Value of Long Stocks'}],lastElementChild:{textContent:'$108,139.29'}},{children:[{textContent:'Value of Shorts'}],lastElementChild:{textContent:'($36,703.55)'}}];
 let readyRows=rows.slice(0,1);
 const doc={body:{innerText:'Game Dates: 09/08/2026 to 12/04/2026'},querySelectorAll:s=>s==='div'?divs:s==='tr'?readyRows:s==='input'?[{value:'10/02/2026'}]:[]};
 const withDOM=fn=>{const old=globalThis.document;globalThis.document=doc;try{return fn();}finally{globalThis.document=old;}};
 const page={waitForFunction:async fn=>withDOM(()=>{assert.equal(fn(),false);readyRows=rows;assert.equal(fn(),true);}),evaluate:async fn=>withDOM(fn)};
 const smg=new SMG(page,Date.now()+10000);smg.goto=async()=>{};
 const summary=await smg.summary();assert.equal(summary.buyingPower,'$-54.91');assert.equal(summary.shortValue,'($36,703.55)');assert.equal(summary.end,'12/04/2026');
});
