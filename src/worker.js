import puppeteer from '@cloudflare/puppeteer';
import {SMG} from './smg.js';
import {marketData,trendSummary} from './market-data.js';
import {money,isoDate,localClock,tradingWindow,snapshotDateAllowed,latestSessionDate,plan,aggregate} from './core.js';

async function pause(env) {await env.DB.prepare("UPDATE settings SET value='true' WHERE key='paused'").run();}
function response(body,status=200) {return Response.json(body,{status,headers:{'Cache-Control':'no-store'}});}
async function authorized(request,env) {
 if(!env.ADMIN_TOKEN||!request.headers.get('Authorization')?.startsWith('Bearer '))return false;
 const a=new TextEncoder().encode(request.headers.get('Authorization').slice(7));
 const b=new TextEncoder().encode(env.ADMIN_TOKEN);
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}

export async function run(env,manual=false,modeOverride,launchBrowser=puppeteer.launch.bind(puppeteer),clockNow=()=>new Date()) {
 const now=clockNow();
 if(now.getUTCFullYear()>2026)return {status:'game_ended'};
 const clock=localClock(now),window=tradingWindow(now,env.GAME_END);
 const mode=modeOverride||env.MODE||'observe';
 const quoteDate=manual&&mode!=='live'?latestSessionDate(now):clock.date;
 if(modeOverride&&(!manual||modeOverride!=='preview'))throw Error('Invalid diagnostic mode');
 if(!['observe','preview','live'].includes(mode))throw Error('Invalid mode');
 if(!manual&&env.ENABLED!=='true')return {status:'disabled'};
 if(mode==='live'&&!window.allowed||mode==='preview'&&!manual&&!window.allowed)return {status:'outside_execution_window'};
 if(clock.date>env.GAME_END)return {status:'game_ended'};
 if(mode==='live'&&env.ADAPTER_VALIDATED!=='true')return {status:'live_adapter_not_validated'};
 if(!env.SMG_USERNAME||!env.SMG_PASSWORD)throw Error('Game secrets not configured');
 const paused=await env.DB.prepare("SELECT value FROM settings WHERE key='paused'").first('value');
 if(paused==='true')return {status:'paused_for_review'};
 const id=`${clock.date}:${mode==='live'?'execute':mode}`;
 const claim=await env.DB.prepare('INSERT OR IGNORE INTO runs(id,started,status) VALUES(?,?,?)').bind(id,now.toISOString(),'started').run();
 if(claim.meta.changes!==1)return {status:'already_attempted_today'};
 let browser,smg;const started=Date.now(),report={mode,date:clock.date,status:'started',warnings:[]};
 try {
  browser=await launchBrowser(env.BROWSER);
  const page=await browser.newPage();page.setDefaultTimeout(12000);
  smg=new SMG(page,started+220000);
  report.stage='login';
  await smg.login(env.SMG_USERNAME,env.SMG_PASSWORD);
  report.stage='account_summary';
  const raw=await smg.summary();
  report.snapshotDates={account:raw.date,expected:clock.date,quoteDate,gameEnd:raw.end};
  if(isoDate(raw.end)!==env.GAME_END)throw Error('Game deadline changed');
  const account={equity:money(raw.equity),cash:money(raw.cash),buyingPower:money(raw.buyingPower),date:isoDate(raw.date),quoteDate};
  if(!snapshotDateAllowed(account.date,now,manual&&mode!=='live'))throw Error('Account snapshot date does not match trading date');
  if(account.date!==clock.date)report.warnings.push('Game displays the next UTC date; permitted only for this manual after-hours diagnostic. Price checks still use the New York trading date.');
  report.stage='holdings';const lots=await smg.holdings(raw);
  report.stage='pending_orders';const pending=await smg.pending();
  const positionsNow=aggregate(lots),outstanding=await env.DB.prepare("SELECT * FROM orders WHERE status='pending'").all();
  for(const old of outstanding.results) {
   if(pending.some(p=>p.confirmation===old.confirmation))continue;
   const current=positionsNow.find(p=>p.symbol===old.symbol)?.shares||0;
   const sign=['Buy','Short Cover'].includes(old.action)?1:-1;
   const expected=old.baseline_shares+sign*old.quantity;
   if(current===expected)await env.DB.prepare("UPDATE orders SET status='filled' WHERE id=?").bind(old.id).run();
   else {await env.DB.prepare("UPDATE orders SET status='unknown' WHERE id=?").bind(old.id).run();await pause(env);throw Error('Fill does not reconcile with holdings');}
  }
  const ambiguous=await env.DB.prepare("SELECT id FROM orders WHERE status IN ('submitting','unknown') LIMIT 1").first();
  if(ambiguous)throw Error('Unresolved order in journal; reconcile manually');
  const positions=aggregate(lots),quotes={},histories={};
  const symbols=[...new Set((env.WATCHLIST||'SPY').split(',').map(s=>s.trim()).filter(Boolean).concat(positions.map(p=>p.symbol)))];
  if(symbols.length>20)throw Error('Watchlist exceeds free-runtime budget');
  report.quoteChecks={};
  for(const symbol of symbols) {
   report.stage=`quote:${symbol}`;
   smg.checkTime();
   try {
    const q=await smg.quote(symbol,quoteDate);
    report.quoteChecks[symbol]={date:q.date,price:q.price,status:q.date===quoteDate?'current':'stale'};
    if(q.date!==quoteDate)throw Error('Stale quote');
    quotes[symbol]=q;
    await env.DB.prepare('INSERT INTO history(symbol,date,price) VALUES(?,?,?) ON CONFLICT(symbol,date) DO UPDATE SET price=excluded.price').bind(symbol,q.date,q.price).run();
   } catch (error) {
    if(/verification|budget|layout|missing|ambiguous|ticker|timeout|monetary/i.test(error.message))throw error;
    if(!report.quoteChecks[symbol])report.quoteChecks[symbol]={status:'unavailable',reason:error?.name==='TimeoutError'?'Lookup timed out':'Unclassified quote reader failure',diagnostics:smg.quoteDiagnostics};
    report.warnings.push(`${symbol}: quote unavailable, no entry`);
   }
   const rows=await env.DB.prepare('SELECT price FROM history WHERE symbol=? AND date<=? ORDER BY date DESC LIMIT 64').bind(symbol,quoteDate).all();
   histories[symbol]=rows.results.map(r=>r.price).reverse();
  }
  report.stage='external_market_data';
  let external;
  try {external=await marketData({...env,MARKET_DATA_AS_OF_DATE:quoteDate},symbols,clockNow());}
  catch {report.warnings.push('External market data unavailable; using verified game data only');}
  report.marketAnalysis={};
  report.externalDataConfigured=env.MARKET_DATA_PROVIDER!=='none';
  for(const symbol of symbols) {
   const data=external?.[symbol],game=quotes[symbol];
   if(!data)continue;
   const price=data.quote?.price||game?.price||data.analysisPrice;
   report.marketAnalysis[symbol]={...trendSummary(data.history,price),source:data.source||'alpaca_iex',intraday:data.intraday||[],dailyCloses:data.history};
   if(game&&data.quote&&Math.abs(data.quote.price/game.price-1)>.05) {
    delete quotes[symbol];report.quoteChecks[symbol]={status:'blocked',reason:'External and game prices differ by more than 5%'};continue;
   }
   const prior=data.history.at(-1);
   if(game&&data.history.length>=20&&Math.abs(prior/game.previous-1)<=.05)histories[symbol]=data.history.concat(game.price);
   if(!game&&data.quote&&data.history.length>=20) {
    quotes[symbol]={...data.quote,previous:prior,marketCap:0};
    histories[symbol]=data.history.concat(data.quote.price);
    report.quoteChecks[symbol]={status:'current_external',date:data.quote.date,price:data.quote.price,source:data.quote.source};
   }
  }
  // Replace close-valued holdings with the verified current quote where available.
  const valued=lots.map(l=>quotes[l.symbol]?{...l,price:quotes[l.symbol].price}:l);
  const decision=plan(account,valued,pending,quotes,histories);
  report.account=account;report.positions=aggregate(valued);report.pending=pending;
  report.blockedOrders=decision.orders.filter(o=>!quotes[o.symbol]);
  report.orders=decision.orders.filter(o=>quotes[o.symbol]);report.warnings.push(...decision.warnings);
  for(const order of report.blockedOrders)report.warnings.push(`${order.symbol}: proposed trade blocked without a current verified price`);
  let openingBudget=Math.max(0,account.buyingPower-.10*account.equity);
  const verifiedOrders=[];
  if(mode!=='observe') for(const order of report.orders) {
   report.stage=`preview:${order.symbol}`;
   smg.checkTime();
   if(!quotes[order.symbol]||quotes[order.symbol].date!==quoteDate)throw Error('No current verified quote for intended trade');
   // Re-read pending orders before every submission, including manual orders.
   const before=await smg.pending();
   if(before.some(p=>p.symbol===order.symbol))throw Error('New pending order conflicts with decision');
   let preview;
   try {preview=await smg.preview(order,quoteDate,openingBudget);}
   catch(error) {
    if(error.message!=='Insufficient buying power in preview')throw error;
    report.blockedOrders.push({...order,blockedReason:error.message});
    report.warnings.push(`${order.symbol}: game preview shows insufficient buying power; order skipped`);
    continue;
   }
   order.preview=preview;
   verifiedOrders.push(order);
   if(mode==='preview')continue;
   if(!tradingWindow(clockNow(),env.GAME_END).allowed)throw Error('Execution window ended before submission');
   const orderId=`${id}:${order.symbol}:${order.action}`;
   await env.DB.prepare('INSERT INTO orders(id,run_id,symbol,action,quantity,status,baseline_shares,created) VALUES(?,?,?,?,?,?,?,?)').bind(orderId,id,order.symbol,order.action,order.quantity,'submitting',positions.find(p=>p.symbol===order.symbol)?.shares||0,new Date().toISOString()).run();
   // Never retry after the submit call; an exception may mean it already succeeded.
   try {
    report.stage=`submit:${order.symbol}`;
    await smg.submit(env.SMG_PASSWORD);
    const after=await smg.pending(),old=new Set(before.map(p=>p.confirmation));
    const accepted=after.filter(p=>!old.has(p.confirmation)&&p.symbol===order.symbol&&p.action===order.action&&p.quantity===order.quantity&&p.confirmation);
    if(accepted.length!==1)throw Error('Cannot verify exactly one accepted pending order');
    await env.DB.prepare("UPDATE orders SET status='pending',confirmation=? WHERE id=?").bind(accepted[0].confirmation,orderId).run();
    order.confirmation=accepted[0].confirmation;
    if(['Buy','Short Sell'].includes(order.action))openingBudget-=money(preview['Last Known SMG Price*'])*order.quantity*1.04+5;
   } catch {
    await env.DB.prepare("UPDATE orders SET status='unknown' WHERE id=?").bind(orderId).run();
    await pause(env);throw Error('Submission outcome unknown; paused without retry');
   }
  }
  if(mode!=='observe')report.orders=verifiedOrders;
  report.status=mode==='live'?(report.orders.length?'submitted_pending_verification':'no_orders_submitted'):mode==='preview'?(report.orders.length?'previews_verified':'no_eligible_previews'):'observed';
 } catch (error) {
  // Do not log raw browser exceptions: a URL or protocol error can include secrets.
  report.errorType=['TimeoutError','ProtocolError','TargetCloseError','Error','TypeError','ReferenceError','SyntaxError','RangeError'].includes(error?.name)?error.name:'Other';
  report.failureKind=/detached|not connected/i.test(error?.message||'')?'detached_control':/context.*destroyed|navigation/i.test(error?.message||'')?'navigation_interrupted':/not.*function|not.*defined|undefined|null/i.test(error?.message||'')?'reader_programming_error':/timeout|timed out|exceeded/i.test(error?.message||'')?'timeout':'other';
  report.status='failed';report.warnings.push('Run failed safely. Review account and configuration before retrying.');
  const safeErrors=['Game rejected login credentials','Site verification blocks automation; no bypass attempted','Account identity or end-of-day game verification failed','Summary layout changed','Account detail missing','Account date missing','Game deadline changed','Account snapshot date does not match trading date','Invalid account date','Trade preview does not match intended order','Stale trade preview','Trade preview price discrepancy','Insufficient buying power in preview','Preview exceeds reserved opening budget','Control missing or ambiguous','Missing control','Quote layout changed','Quote date missing','Ticker lookup company missing','Invalid monetary value','No current verified quote for intended trade','Execution window ended before submission','Browser runtime budget reached'];
  report.errorCode=safeErrors.includes(error?.message)?error.message:(error?.name==='TimeoutError'||/Waiting failed:.*exceeded|timeout.*exceeded/i.test(error?.message||''))?'Page or control timed out':'Unclassified integration failure';
  if(report.stage==='login')report.diagnostics=smg?.loginDiagnostics;
  if(report.stage==='account_summary')report.diagnostics=smg?.summaryDiagnostics;
  if(report.stage?.startsWith('quote:')||report.stage?.startsWith('preview:'))report.diagnostics=smg?.quoteDiagnostics;
  if(report.stage==='holdings') {
   report.diagnostics=smg?.diagnostics;
   const known=['Pagination control missing or ambiguous','Holdings pagination stalled','Holdings page count exceeded','Holdings column count changed','Unsupported asset type','Invalid monetary value','Nonfinite monetary value','Invalid position','Position direction mismatch','Inconsistent position lots','Holdings do not reconcile with account totals','Browser runtime budget reached','Site verification blocks automation; no bypass attempted'];
   report.errorCode=known.includes(error?.message)?error.message:error?.name==='TimeoutError'?'Holdings page or pagination timed out':`Unrecognized holdings reader error (${report.errorType}/${report.failureKind})`;
  }
  if(mode==='live')await pause(env);
 } finally {
  if(browser)await browser.close().catch(()=>{});
  report.durationMs=Date.now()-started;
  await env.DB.prepare('UPDATE runs SET status=?,report=?,finished=? WHERE id=?').bind(report.status,JSON.stringify(report),new Date().toISOString(),id).run();
 }
 return report;
}

export default {
 async scheduled(controller,env,ctx) {
  // UTC schedules cover DST and the one half-day; only one eligible local run.
  const timestamp=new Date(controller.scheduledTime);
  if(timestamp.getUTCFullYear()!==2026||env.ENABLED!=='true'||!tradingWindow(timestamp,env.GAME_END).allowed)return;
  ctx.waitUntil(run(env));
 },
 async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET')return response({service:'SMG bot',configuredMode:env.MODE,scheduled:env.ENABLED==='true'});
  if(!await authorized(request,env))return response({error:'Unauthorized'},401);
  try {
   if(path==='/status'&&request.method==='GET') {
    const latest=await env.DB.prepare('SELECT id,status,report,started,finished FROM runs ORDER BY started DESC LIMIT 5').all();
    return response({runs:latest.results.map(r=>({...r,report:r.report?JSON.parse(r.report):null}))});
   }
   if(path==='/run'&&request.method==='POST')return response(await run(env,true));
   if(path==='/preview'&&request.method==='POST') {
    if(env.MODE!=='observe')return response({error:'Diagnostic previews require observation mode'},409);
    const id=`${localClock(new Date()).date}:preview`;
    await env.DB.prepare("DELETE FROM runs WHERE id=? AND status IN ('failed','previews_verified','no_eligible_previews')").bind(id).run();
    return response(await run(env,true,'preview'));
   }
   if(path==='/retry-observe'&&request.method==='POST') {
    if(env.MODE!=='observe')return response({error:'Retry is only available in observation mode'},409);
    const id=`${localClock(new Date()).date}:observe`;
    await env.DB.prepare("DELETE FROM runs WHERE id=? AND status IN ('failed','observed')").bind(id).run();
    return response(await run(env,true));
   }
   if(path==='/pause'&&request.method==='POST') {await pause(env);return response({paused:true});}
   if(path==='/resume'&&request.method==='POST') {
    const unresolved=await env.DB.prepare("SELECT id FROM orders WHERE status IN ('submitting','unknown') LIMIT 1").first();
    if(unresolved)return response({error:'Reconcile ambiguous order first'},409);
    await env.DB.prepare("UPDATE settings SET value='false' WHERE key='paused'").run();return response({paused:false});
   }
   return response({error:'Not found'},404);
  } catch {return response({error:'Configuration or database operation failed'},500);}
 }
};
