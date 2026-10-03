import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from '@cloudflare/puppeteer';
import worker from '../src/worker.js';
import {SMG} from '../src/smg.js';
import {localClock,latestSessionDate} from '../src/core.js';

test('manual preview outside execution window never submits or consumes live fence',async()=>{
 const originals={launch:puppeteer.launch};
 const methods=['login','summary','holdings','pending','quote','preview','submit'];
 for(const name of methods)originals[name]=SMG.prototype[name];
 const date=localClock(new Date()).date,quoteDate=latestSessionDate(new Date()),us=date.slice(5,7)+'/'+date.slice(8,10)+'/'+date.slice(0,4);
 const sqls=[];let previews=0,submits=0;
 puppeteer.launch=async()=>({newPage:async()=>({setDefaultTimeout:()=>{}}),close:async()=>{}});
 SMG.prototype.login=async()=>{};
 SMG.prototype.summary=async()=>({end:'12/04/2026',date:us,equity:'100000',buyingPower:'1000',cash:'1000'});
 SMG.prototype.holdings=async()=>[{symbol:'CRML',asset:'stock',side:'Long',shares:100,cost:1000,price:7}];
 SMG.prototype.pending=async()=>[];
 SMG.prototype.quote=async()=>({price:7,previous:7,date:quoteDate,marketCap:1e9});
 SMG.prototype.preview=async()=>{previews++;return {Action:'Sell'};};
 SMG.prototype.submit=async()=>{submits++;throw Error('Preview must never submit');};
 const env={MODE:'observe',ENABLED:'false',GAME_END:'2026-12-04',ADMIN_TOKEN:'test',SMG_USERNAME:'test-user',SMG_PASSWORD:'test-password',WATCHLIST:'CRML',DB:{prepare:sql=>{
  sqls.push(sql);let bindings=[];
  const statement={bind:(...args)=>{bindings=args;return statement;},first:async()=>null,all:async()=>({results:[]}),run:async()=>{if(sql.startsWith('INSERT OR IGNORE INTO runs'))assert.equal(bindings[0],date+':preview');return {meta:{changes:1}};}};
  return statement;
 }}};
 try {
  const response=await worker.fetch(new Request('https://test/preview',{method:'POST',headers:{Authorization:'Bearer test'}}),env);
  const report=await response.json();assert.equal(report.status,'previews_verified');assert.equal(previews,1);assert.equal(submits,0);
  assert.ok(!sqls.some(sql=>sql.startsWith('INSERT INTO orders')));
 } finally {
  puppeteer.launch=originals.launch;for(const name of methods)SMG.prototype[name]=originals[name];
 }
});
