import puppeteer from 'puppeteer-core';
import {writeFile} from 'node:fs/promises';
import {run} from '../src/worker.js';
import {localClock,tradingWindow} from '../src/core.js';
import {RemoteD1} from './d1.js';
import {publicReport} from './report.js';
const action=process.env.RUN_ACTION||'observe',now=new Date();
const manual=process.env.GITHUB_EVENT_NAME!=='schedule';
const env={...process.env,MODE:process.env.BOT_MODE||'observe',ENABLED:process.env.BOT_ENABLED||'false',GAME_END:'2026-12-04',WATCHLIST:'SPY,COIN,CRML,DELL,IBRX,IRON,MRVL,MU,NKE,NVDA,ORCL'};
if(!['observe','preview','status','scheduled'].includes(action))throw Error('Invalid runner action');
if(!manual&&(!tradingWindow(now,env.GAME_END).allowed||env.ENABLED!=='true')){
 console.log(JSON.stringify({status:'disabled_or_outside_window'}));process.exit(0);
}
let report;
try {
 env.DB=new RemoteD1(env.CLOUDFLARE_ACCOUNT_ID,env.D1_DATABASE_ID,env.CLOUDFLARE_D1_TOKEN);
 if(action==='status') {
  const records=await env.DB.prepare('SELECT id,status,report,started,finished FROM runs ORDER BY started DESC LIMIT 5').all();
  report={runs:records.results.map(r=>({...r,report:r.report?JSON.parse(r.report):null}))};
 } else {
  if(manual&&env.MODE!=='observe')throw Error('Manual diagnostics require observation mode');
  if(manual) {
   const mode=action==='preview'?'preview':'observe',id=`${localClock(now).date}:${mode}`;
   // A terminated read-only diagnostic has no submissions to duplicate. Do not touch execution fences.
   await env.DB.prepare("DELETE FROM runs WHERE id=? AND (status IN ('failed','observed','previews_verified','no_eligible_previews') OR (status='started' AND started<?))").bind(id,new Date(now.getTime()-600000).toISOString()).run();
  }
  report=await run(env,manual,action==='preview'?'preview':undefined,()=>puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true}));
 }
 const diagnostic=publicReport(report);
 await writeFile('report.json',JSON.stringify(diagnostic,null,2));
 console.log(JSON.stringify(diagnostic,null,2));
 if(report.status==='failed')process.exitCode=1;
} catch {
 // Never print raw browser/network exceptions or headers into workflow logs.
 console.log(JSON.stringify({status:'runner_failed',error:'Check private secrets, D1 permissions, and saved status. No automatic retry was performed.'}));process.exitCode=1;
}
