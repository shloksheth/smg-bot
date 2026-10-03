import test from 'node:test';
import assert from 'node:assert/strict';
import {money,aggregate,plan,signal,tradingWindow,snapshotDateAllowed,verifyPreview} from '../src/core.js';
const account={equity:100000,buyingPower:50000,cash:50000,quoteDate:'2026-10-02'};
const lot=(symbol,side,shares,cost,price)=>({symbol,side,shares,cost,price,asset:'stock'});
test('parses negative cash and parentheses',()=>{assert.equal(money('-$11,807.46'),-11807.46);assert.equal(money('($9,470.20)'),-9470.20);assert.throws(()=>money('NA'));});
test('combines MU lots instead of issuing two exits',()=>{const p=aggregate([lot('MU','Long',10,10656.10,1097.39),lot('MU','Long',10,10655.80,1097.39)]);assert.equal(p.length,1);assert.equal(p[0].shares,20);assert.equal(p[0].cost,21311.9);});
test('short P/L loses money when price rises',()=>{assert.equal(aggregate([lot('IBRX','Short',-1000,-7714.84,9.28)])[0].pnl,-1565.1599999999999);});
test('rejects incompatible lots and invalid direction',()=>{assert.throws(()=>aggregate([lot('MU','Long',10,100,10),lot('MU','Short',-10,-100,10)]));assert.throws(()=>aggregate([lot('COIN','Short',55,10000,180)]));});
test('negative buying power cannot open positions',()=>{const h=Array.from({length:21},(_,i)=>100+i);const q={SPY:{price:120,previous:119,date:'2026-10-02',marketCap:1e9}};assert.deepEqual(plan({...account,buyingPower:-55},[],[],q,{SPY:h}).orders,[]);});
test('pending order blocks repeated exit',()=>{const result=plan(account,[lot('CRML','Long',1000,10000,7)], [{symbol:'CRML'}],{},{});assert.equal(result.orders.length,0);});
test('one aggregated short cover respects available shares',()=>{const r=plan(account,[lot('IBRX','Short',-1000,7714.84,10.33)],[],{},{});assert.equal(r.orders[0].action,'Short Cover');assert.equal(r.orders[0].quantity,1000);});
test('loss exit does not spend its unfilled proceeds',()=>{const q={SPY:{price:120,previous:119,date:'2026-10-02',marketCap:1e9}},h={SPY:Array.from({length:21},(_,i)=>100+i)};const r=plan({...account,buyingPower:0},[lot('CRML','Long',1000,10000,7)],[],q,h);assert.equal(r.orders.length,1);assert.equal(r.orders[0].action,'Sell');});
test('entries respect minimum shares and reserved capital',()=>{const q={SPY:{price:120,previous:119,date:'2026-10-02',marketCap:1e9}},h={SPY:Array.from({length:21},(_,i)=>100+i)};const r=plan(account,[],[],q,h);assert.equal(r.orders[0].action,'Buy');assert.ok(r.orders[0].quantity>=10);assert.ok(r.orders[0].quantity*120*1.04+5<=40000);});
test('stale quote and penny stock block openings',()=>{const h={SPY:Array.from({length:21},(_,i)=>100+i)};for(const q of [{price:120,previous:119,date:'2026-10-01',marketCap:1e9},{price:120,previous:2,date:'2026-10-02',marketCap:1e9}])assert.equal(plan(account,[],[],{SPY:q},h).orders.length,0);});
test('trend history warmup is explicit',()=>{assert.equal(signal([1,2,3]),null);assert.equal(signal(Array(21).fill(100)).side,null);});
test('normal window accounts for DST change',()=>{assert.ok(tradingWindow(new Date('2026-10-02T18:30:00Z')).allowed);assert.ok(!tradingWindow(new Date('2026-11-02T18:30:00Z')).allowed);assert.ok(tradingWindow(new Date('2026-11-02T19:30:00Z')).allowed);});
test('holiday, half-day and competition stop date',()=>{assert.ok(!tradingWindow(new Date('2026-11-26T19:30:00Z')).allowed);assert.ok(tradingWindow(new Date('2026-11-27T16:30:00Z')).allowed);assert.ok(!tradingWindow(new Date('2026-11-27T19:30:00Z')).allowed);assert.ok(!tradingWindow(new Date('2026-12-07T20:17:00Z')).allowed);});
test('preview rejects wrong symbol, stale prices and insufficient budget',()=>{const order={symbol:'MRVL',action:'Buy',quantity:10,referencePrice:272};const p={Action:'Buy',Ticker:'MRVL','# Of Shares':'10','Order Type':'Market Order','Last Known SMG Price Date':'10/02/2026','Last Known SMG Price*':'$272.29','Estimated Buying Power After Trade':'$2000'};assert.ok(verifyPreview(order,p,'2026-10-02',3000));assert.throws(()=>verifyPreview(order,{...p,Ticker:'MU'},'2026-10-02',3000));assert.throws(()=>verifyPreview(order,p,'2026-10-01',3000));assert.throws(()=>verifyPreview(order,p,'2026-10-02',2000));});

test('next UTC date permitted only in manual after-hours diagnostics',()=>{
 const now=new Date('2026-10-03T00:22:00Z');
 assert.equal(snapshotDateAllowed('2026-10-02',now),true);
 assert.equal(snapshotDateAllowed('2026-10-03',now),false);
 assert.equal(snapshotDateAllowed('2026-10-03',now,true),true);
 assert.equal(snapshotDateAllowed('2026-10-01',now,true),false);
 assert.equal(snapshotDateAllowed('2026-10-04',now,true),false);
 assert.equal(snapshotDateAllowed('2026-10-03',new Date('2026-10-02T18:30:00Z'),true),false);
});
