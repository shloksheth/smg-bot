import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../src/worker.js';
import {SMG} from '../src/smg.js';
const instant=new Date('2026-10-02T18:30:00Z');
for(const outcome of ['accepted','ambiguous','throw','unfunded'])test(`live submission ${outcome} journals before click and never retries`,async()=>{
 const methods=['login','summary','holdings','pending','quote','preview','submit'],originals={};
 for(const m of methods)originals[m]=SMG.prototype[m];
 const statements=[];let submissions=0,pendingCalls=0,paused=false;
 const env={MARKET_DATA_PROVIDER:'none',MODE:'live',ENABLED:'true',ADAPTER_VALIDATED:'true',GAME_END:'2026-12-04',SMG_USERNAME:'test',SMG_PASSWORD:'test',WATCHLIST:'CRML',DB:{prepare(sql){
  const statement={bind(...args){statements.push({sql,args});return statement;},async first(){return null;},async all(){return {results:[]};},async run(){if(sql.includes("UPDATE settings SET value='true'"))paused=true;return {meta:{changes:1}};}};return statement;
 }}};
 SMG.prototype.login=async()=>{};
 SMG.prototype.summary=async()=>({end:'12/04/2026',date:'10/02/2026',equity:'100000',cash:'1000',buyingPower:'1000'});
 SMG.prototype.holdings=async()=>[{symbol:'CRML',asset:'stock',side:'Long',shares:100,cost:1000,price:7}];
 SMG.prototype.quote=async()=>({price:7,previous:7,date:'2026-10-02',marketCap:1e9});
 SMG.prototype.preview=async()=>{if(outcome==='unfunded')throw Error('Insufficient buying power in preview');return {Action:'Sell'};};
 SMG.prototype.pending=async()=>{pendingCalls++;return pendingCalls>=3&&outcome==='accepted'?[{symbol:'CRML',action:'Sell',quantity:100,confirmation:'CONF-1'}]:[];};
 SMG.prototype.submit=async()=>{assert.ok(statements.some(x=>x.sql.startsWith('INSERT INTO orders')&&x.args[5]==='submitting'));submissions++;if(outcome==='throw')throw Error('network dropped');};
 try {
  const report=await run(env,false,undefined,async()=>({newPage:async()=>({setDefaultTimeout(){}}),close:async()=>{}}),()=>instant);
  assert.equal(submissions,outcome==='unfunded'?0:1);
  if(outcome==='accepted'){assert.equal(report.status,'submitted_pending_verification');assert.equal(report.orders[0].confirmation,'CONF-1');assert.equal(paused,false);}
  else if(outcome==='unfunded'){assert.equal(report.status,'no_orders_submitted');assert.equal(report.blockedOrders.length,1);assert.equal(paused,false);assert.ok(!statements.some(x=>x.sql.startsWith('INSERT INTO orders')));}
  else {assert.equal(report.status,'failed');assert.equal(paused,true);assert.ok(statements.some(x=>x.sql.includes("status='unknown'")));}
 }finally {for(const m of methods)SMG.prototype[m]=originals[m];}
});
