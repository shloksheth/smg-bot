import test from 'node:test';
import assert from 'node:assert/strict';
import {validTrade,priorCloses,marketData,regularBars,trendSummary,chartData} from '../src/market-data.js';
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
  if(url.searchParams.get('timeframe')==='5Min')return {ok:true,json:async()=>({bars:{SPY:[{t:'2026-10-02T18:20:00Z',o:99,h:101,l:98,c:100,v:20}]}})};
  return {ok:true,json:async()=>({bars:{SPY:[{t:'2026-10-01T04:00:00Z',c:99}]}})};
 });
 assert.equal(calls.length,3);assert.equal(result.SPY.quote.price,100);assert.deepEqual(result.SPY.history,[99]);assert.equal(result.SPY.intraday[0].close,100);
 assert.equal(await marketData({MARKET_DATA_PROVIDER:'none'},['SPY'],now),null);
});

test('multi-period returns use completed sessions and insufficient history stays null',()=>{
 const h=Array.from({length:126},(_,i)=>100+i),s=trendSummary(h,226);
 assert.equal(s.returns['1d'],226/225-1);assert.equal(s.returns['5d'],226/221-1);
 assert.equal(s.returns['1mo'],226/205-1);assert.ok(Math.abs(s.returns['6mo']-1.26)<1e-12);
 assert.equal(trendSummary([100],101).returns['1mo'],null);
});
test('intraday excludes extended hours and incomplete or future candles',()=>{
 const b=t=>({t,o:100,h:102,l:99,c:101,v:10});
 assert.equal(regularBars([b('2026-10-02T12:00:00Z'),b('2026-10-02T18:20:00Z'),b('2026-10-02T18:29:00Z'),b('2026-10-02T18:35:00Z')],now).length,1);
});

function publicPayload(symbol,interval) {
 const dates=interval==='1d'?['2026-09-30T13:30:00Z','2026-10-01T13:30:00Z','2026-10-02T13:30:00Z']:['2026-10-02T18:20:00Z','2026-10-02T18:29:00Z'];
 return {chart:{result:[{meta:{symbol,currency:'USD',instrumentType:'ETF',exchangeTimezoneName:'America/New_York',regularMarketPrice:101,regularMarketTime:Date.parse('2026-10-02T18:29:00Z')/1000},timestamp:dates.map(t=>Date.parse(t)/1000),indicators:{quote:[{open:dates.map(()=>100),high:dates.map(()=>102),low:dates.map(()=>99),close:dates.map(()=>100),volume:dates.map(()=>5)}]}}]}};
}
test('keyless personal chart data checks identity, omits future candles and separates history',async()=>{
 const calls=[];
 const data=await marketData({},['SPY'],now,async(url,options)=>{
  calls.push(url);assert.equal(url.host,'query1.finance.yahoo.com');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('includePrePost'),'false');
  return {ok:true,json:async()=>publicPayload('SPY',url.searchParams.get('interval'))};
 });
 assert.equal(calls.length,2);assert.equal(data.SPY.source,'yahoo_public');assert.equal(data.SPY.quote.price,101);assert.deepEqual(data.SPY.history,[100,100]);assert.equal(data.SPY.intraday.length,1);
 const wrong=publicPayload('COIN','1d');assert.throws(()=>chartData(wrong,'SPY'),/identity/);
});
test('public data rejection does not retry or substitute an unverified price',async()=>{
 let requests=0;
 await assert.rejects(marketData({},['SPY'],now,async()=>{requests++;return {ok:false};}),/unavailable/);
 assert.equal(requests,2);
});
test('weekend chart diagnostics keep Friday candles without accepting a stale live quote',async()=>{
 const data=await marketData({MARKET_DATA_AS_OF_DATE:'2026-10-02'},['SPY'],new Date('2026-10-03T18:30:00Z'),async url=>({ok:true,json:async()=>publicPayload('SPY',url.searchParams.get('interval'))}));
 assert.equal(data.SPY.quote,null);assert.equal(data.SPY.intraday.length,2);
});
