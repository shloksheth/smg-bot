import test from 'node:test';
import assert from 'node:assert/strict';
import {SMG} from '../src/smg.js';

function fixture({disabled=false,missing=false}={}) {
 let clicks=0,waits=0,disposed=0;
 const control={getAttribute:()=>disabled?'true':null,classList:{contains:()=>disabled},click:async()=>{clicks++;}};
 const arrow={closest:()=>control};
 const page={
  evaluateHandle:async fn=>{
   const original=globalThis.document;
   globalThis.document={querySelectorAll:selector=>{assert.equal(selector,'.google-visualization-table-page-next');return missing?[]:[arrow];}};
   let result;try {result=fn();} finally {globalThis.document=original;}
   return {asElement:()=>result,dispose:async()=>{disposed++;}};
  },
  waitForFunction:async(fn,options,before,kind)=>{assert.equal(before,'[["ORCL"]]');assert.equal(kind,'holdings');waits++;},
 };
 return {smg:new SMG(page,Date.now()+10000),counts:()=>({clicks,waits,disposed})};
}
test('CSS arrow inside role button advances holdings and waits for changed rows',async()=>{
 const f=fixture();assert.equal(await f.smg.nextPage([['ORCL']],'holdings'),true);
 assert.deepEqual(f.counts(),{clicks:1,waits:1,disposed:1});
});
test('disabled last-page control stops without clicking',async()=>{
 const f=fixture({disabled:true});assert.equal(await f.smg.nextPage([['ORCL']],'holdings'),false);
 assert.deepEqual(f.counts(),{clicks:0,waits:0,disposed:1});
});
test('missing pagination fails instead of silently truncating holdings',async()=>{
 const f=fixture({missing:true});await assert.rejects(f.smg.nextPage([['ORCL']],'holdings'),/Pagination control missing/);
});
