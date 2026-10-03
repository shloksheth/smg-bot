import test from 'node:test';
import assert from 'node:assert/strict';
import {validTrade,priorCloses,marketData} from '../src/market-data.js';
const now=new Date('2026-10-02T18:30:00Z');
test('external trades must be fresh, positive and from the regular session',()=>{
 assert.ok(validTrade({p:100,t:'2026-10-02T18:29:00Z'},now));
 for(const t of ['2026-10-02T18:20:00Z','2026-10-02T18:31:00Z','2026-10-01T18:29:00Z'])assert.equal(validTrade({p:100,t},now),null);
 assert.equal(validTrade({p:-1,t:'2026-10-02T18:29:00Z'},now),null);
 assert.equal(validTrade({p:100,t:'2026-10-02T12:29:00Z'},new Date('2026-10-02T12:30:00Z')),null);
});
test('history excludes today and future bars, sorts dates and rejects duplicate dates',()=>{
 const bars=[{t:'2026-10-01T04:00:00Z',c:100},{t:'2026-09-30T04:00:00Z',c:99},{t:'2026-10-02T04:00:00Z',c:101}];
 assert.deepEqual(priorCloses(bars,'2026-10-02'),[99,100]);
 assert.throws(()=>priorCloses(bars.concat(bars[0]),'2026-10-02'),/Duplicate/);
});
test('provider has no brokerage operations and explicitly requests free IEX feed with split adjustments',async()=>{
 let calls=[];
 const result=await marketData({MARKET_DATA_KEY:'test-key',MARKET_DATA_SECRET:'test-secret'},['SPY'],now,async(url,options)=>{
  calls.push(String(url));assert.equal(options.headers['APCA-API-KEY-ID'],'test-key');assert.equal(url.host,'data.alpaca.markets');assert.equal(url.searchParams.get('feed'),'iex');
  if(url.pathname.endsWith('latest'))return {ok:true,json:async()=>({trades:{SPY:{p:100,t:'2026-10-02T18:29:00Z'}}})};
  assert.equal(url.searchParams.get('adjustment'),'split');
  return {ok:true,json:async()=>({bars:{SPY:[{t:'2026-10-01T04:00:00Z',c:99}]}})};
 });
 assert.equal(calls.length,2);assert.equal(result.SPY.quote.price,100);assert.deepEqual(result.SPY.history,[99]);
 assert.equal(await marketData({},['SPY'],now),null);
});
