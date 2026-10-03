import {money,isoDate,aggregate,verifyPreview} from './core.js';
const ROOT='https://www.stockmarketgame.org';
export function companyIdentity(value) {
 return value.toUpperCase().replace(/\b(COMMON STOCK|ORDINARY SHARES|UNIT|UNITS)\s*$/,'').replace(/[^A-Z0-9]/g,'');
}
export class SMG {
 constructor(page,deadline) {this.page=page;this.deadline=deadline;this.diagnostics={};}
 checkTime() {if(Date.now()>this.deadline)throw Error('Browser runtime budget reached');}
 async guard() {
  this.checkTime();
  const text=await this.page.evaluate(()=>document.body.innerText.slice(0,1500));
  if(/verify you are human|performing security verification|protect against malicious bots|access denied|automated traffic/i.test(text))throw Error('Site verification blocks automation; no bypass attempted');
 }
 async goto(path) {
  this.checkTime();await this.page.goto(ROOT+path,{waitUntil:'domcontentloaded',timeout:20000});await this.guard();
 }
 async clickText(text,selector='button,a,div') {
  this.checkTime();
  const h=await this.page.evaluateHandle((text,selector)=>{
   const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
   const norm=s=>s.trim().replace(/\s+/g,'').toLowerCase();
   const es=[...document.querySelectorAll(selector)].filter(e=>visible(e)&&norm(e.tagName==='INPUT'?e.value:e.textContent)===norm(text));
   if(es.length!==1)throw Error('Control missing or ambiguous');return es[0];
  },text,selector);
  const e=h.asElement();if(!e)throw Error('Missing control');await e.click();await h.dispose();
 }
 async login(username,password) {
  this.loginDiagnostics={step:'open_login'};
  await this.goto('/login.html');
  this.loginDiagnostics.step='find_login_fields';
  await this.page.waitForSelector('input[name="ACCOUNTNO"]',{visible:true,timeout:10000});
  await this.page.type('input[name="ACCOUNTNO"]',username);
  await this.page.type('input[name="USER_PIN"]',password);
  this.loginDiagnostics.step='submit_login';
  await this.clickText('Log In','button,input[type="button"]');
  this.loginDiagnostics.step='wait_signed_in_page';
  let waitError;
  try {
   await this.page.waitForFunction(()=>{
    const text=document.body.innerText;
    return /Trade\s*Type\s*:/i.test(text)||/invalid\s+(account|team|password|user)|incorrect\s+(password|team|user)|login\s+failed|unable to log in|verify you are human|performing security verification|access denied|automated traffic/i.test(text);
   },{timeout:35000});
  } catch(error) {waitError=error;}
  const state=await this.page.evaluate(()=>{
   const text=document.body.innerText;
   return {
    loginFormPresent:Boolean(document.querySelector('input[name="ACCOUNTNO"]')),
    tradeTypePresent:/Trade\s*Type\s*:/i.test(text),
    credentialsRejected:/invalid\s+(account|team|password|user)|incorrect\s+(password|team|user)|login\s+failed|unable to log in/i.test(text),
    verificationPresent:/verify you are human|performing security verification|access denied|automated traffic/i.test(text),
   };
  });
  Object.assign(this.loginDiagnostics,state);
  await this.guard();
  if(state.credentialsRejected)throw Error('Game rejected login credentials');
  if(state.verificationPresent)throw Error('Site verification blocks automation; no bypass attempted');
  this.loginDiagnostics.step='verify_account_identity';
  const verified=await this.page.evaluate(u=>document.body.innerText.includes(u)&&document.body.innerText.includes('ENDOFDAY'),username);
  this.loginDiagnostics.accountIdentityVerified=verified;
  if(waitError&&!verified)throw waitError;
  if(!verified)throw Error('Account identity or end-of-day game verification failed');
 }
 async summary() {
  this.summaryDiagnostics={step:'open_summary'};
  await this.goto('/pa.html');
  this.summaryDiagnostics.step='wait_complete_summary';
  await this.page.waitForFunction(()=>{
   const divs=[...document.querySelectorAll('div')],rows=[...document.querySelectorAll('tr')];
   const numeric=s=>/^\(?[-+]?\$?[-+]?\d[\d,]*(?:\.\d+)?\)?$/.test(s?.trim()||'');
   const cards=['Total Equity','Buying Power','Cash Balance'].every(label=>{
    const e=divs.find(x=>x.children.length===0&&x.textContent.trim()===label);
    return numeric(e?.parentElement?.parentElement?.parentElement?.querySelector('p')?.textContent);
   });
   const details=['Value of Long Stocks','Value of Shorts'].every(label=>{
    const row=rows.find(r=>r.children[0]?.textContent.trim()===label);
    return numeric(row?.lastElementChild?.textContent);
   });
   const dates=/Game Dates:\s*\d{2}\/\d{2}\/\d{4}\s*to\s*\d{2}\/\d{2}\/\d{4}/.test(document.body.innerText);
   const date=[...document.querySelectorAll('input')].some(e=>/^\d{2}\/\d{2}\/\d{4}$/.test(e.value));
   return cards&&details&&dates&&date;
  },{timeout:20000});
  this.summaryDiagnostics.step='parse_summary';
  return this.page.evaluate(()=>{
   function val(label) {
    const e=[...document.querySelectorAll('div')].find(x=>x.children.length===0&&x.textContent.trim()===label);
    const p=e?.parentElement?.parentElement?.parentElement?.querySelector('p');
    if(!p)throw Error('Summary layout changed');return p.textContent.trim();
   }
   function rowVal(label) {
    const row=[...document.querySelectorAll('tr')].find(r=>r.children[0]?.textContent.trim()===label);
    if(!row)throw Error('Account detail missing');return row.lastElementChild.textContent.trim();
   }
   const text=document.body.innerText,dates=/Game Dates:\s*(\d{2}\/\d{2}\/\d{4})\s*to\s*(\d{2}\/\d{2}\/\d{4})/.exec(text);
   const date=[...document.querySelectorAll('input')].map(e=>e.value).find(x=>/^\d{2}\/\d{2}\/\d{4}$/.test(x));
   if(!dates||!date)throw Error('Account date missing');
   return {equity:val('Total Equity'),buyingPower:val('Buying Power'),cash:val('Cash Balance'),date,end:dates[2],longValue:rowVal('Value of Long Stocks'),shortValue:rowVal('Value of Shorts')};
  });
 }
 async table(kind) {
  await this.page.waitForFunction(kind=>[...document.querySelectorAll('table')].some(t=>t.innerText.includes(kind==='holdings'?'Initial Trade Date':'Confirmation')),{timeout:15000},kind);
  return this.page.evaluate(kind=>{
   const t=[...document.querySelectorAll('table')].find(t=>t.innerText.includes(kind==='holdings'?'Initial Trade Date':'Confirmation'));
   return [...t.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('td')].map(c=>c.innerText.trim())).filter(r=>r.length>0&&!/Ticker|Transaction Type/i.test(r[0]));
  },kind);
 }
 async nextPage(before,kind) {
  this.checkTime();
  if(kind==='holdings'&&this.diagnostics)this.diagnostics.step='locate_holdings_pagination';
  const handle=await this.page.evaluateHandle(()=>{
   const arrows=[...document.querySelectorAll('.google-visualization-table-page-next')];
   if(arrows.length!==1)throw Error('Pagination control missing or ambiguous');
   const button=arrows[0].closest('[role="button"]');
   if(!button)throw Error('Pagination control missing or ambiguous');
   if(button.getAttribute('aria-disabled')==='true'||button.classList.contains('goog-custom-button-disabled'))return null;
   return button;
  });
  if(kind==='holdings'&&this.diagnostics)this.diagnostics.step='resolve_holdings_pagination_handle';
  const next=handle.asElement();
  if(!next){await handle.dispose();return false;}
  if(kind==='holdings'&&this.diagnostics)this.diagnostics.step='click_holdings_next';
  try {await next.click();} finally {await handle.dispose();}
  if(kind==='holdings'&&this.diagnostics)this.diagnostics.step='wait_holdings_page_change';
  await this.page.waitForFunction((before,kind)=>{
   const t=[...document.querySelectorAll('table')].find(t=>t.innerText.includes(kind==='holdings'?'Initial Trade Date':'Confirmation'));
   const rows=t?[...t.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('td')].map(c=>c.innerText.trim())).filter(r=>r.length&&!/Ticker|Transaction Type/i.test(r[0])):null;
   return rows&&JSON.stringify(rows)!==before;
  },{timeout:10000},JSON.stringify(before),kind);
  this.checkTime();return true;
 }
 async holdings(summary) {
  this.diagnostics={step:'open_holdings',pages:0,rows:0,columnCounts:[]};
  await this.goto('/ahold.html');let rows=[],previous=[];
  for(let i=0;i<20;i++) {
   this.diagnostics.step='read_holdings_table';
   this.checkTime();const pageRows=await this.table('holdings');
   if(i&&JSON.stringify(pageRows)===JSON.stringify(previous))throw Error('Holdings pagination stalled');
   rows.push(...pageRows);previous=pageRows;
   this.diagnostics.pages=i+1;this.diagnostics.rows=rows.length;
   this.diagnostics.columnCounts=[...new Set(rows.map(r=>r.length))];
   this.diagnostics.step='holdings_pagination';
   if(!pageRows.length||!await this.nextPage(pageRows,'holdings'))break;
   if(i===19)throw Error('Holdings page count exceeded');
  }
  this.diagnostics.step='parse_holdings';
  const lots=rows.map(r=>{
   if(r.length!==11)throw Error('Holdings column count changed');
   const bond=/^TR_|^MB_|^CB_/.test(r[0]);
   if(r[2].includes('$')&&!bond)throw Error('Unsupported asset type');
   return {symbol:r[0],side:r[1],shares:money(r[2]),date:r[3],cost:money(r[5]),price:money(r[6]),value:money(r[7]),asset:bond?'bond':'stock'};
  });
  this.diagnostics.step='validate_positions';
  aggregate(lots);
  const long=lots.filter(x=>x.asset==='stock'&&x.side==='Long').reduce((a,x)=>a+x.value,0);
  const short=lots.filter(x=>x.asset==='stock'&&x.side==='Short').reduce((a,x)=>a+x.value,0);
  this.diagnostics.step='reconcile_holdings';
  this.diagnostics.totals={long,short,expectedLong:money(summary.longValue),expectedShort:money(summary.shortValue)};
  if(Math.abs(long-money(summary.longValue))>.25||Math.abs(short-money(summary.shortValue))>.25)throw Error('Holdings do not reconcile with account totals');
  return lots;
 }
 async pending() {
  await this.goto('/po.html');const out=[];
  for(let i=0;i<20;i++) {
   const rows=await this.table('pending');
   for(const r of rows) {
    if(r.length!==8)throw Error('Pending order layout changed');
    const action=/short\s*cover/i.test(r[0])?'Short Cover':/short/i.test(r[0])?'Short Sell':/buy/i.test(r[0])?'Buy':/sell/i.test(r[0])?'Sell':null;
    if(!action)throw Error('Unknown pending transaction type');
    out.push({action,quantity:money(r[1]),symbol:r[2],confirmation:r[5],entered:r[4]});
   }
   if(!rows.length||!await this.nextPage(rows,'pending'))break;
   if(i===19)throw Error('Pending page count exceeded');
  }
  return out;
 }
 async selectStock(symbol) {
  this.quoteDiagnostics={step:'open_stock_form'};
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))throw Error('Invalid ticker');
  await this.goto('/enterstock.htm');
  this.quoteDiagnostics.step='find_symbol_input';
  await this.page.waitForSelector('#SymbolName',{visible:true,timeout:10000});
  await this.page.click('#SymbolName',{clickCount:3});
  await this.page.keyboard.press('Backspace');
  await this.page.type('#SymbolName',symbol);
  this.quoteDiagnostics.step='wait_lookup_results';
  await this.page.waitForFunction(s=>[...document.querySelectorAll('p')].some(e=>e.textContent.trim()===s),{timeout:10000},symbol);
  const company=await this.page.evaluate(s=>{const ps=[...document.querySelectorAll('p')],i=ps.findIndex(e=>e.textContent.trim()===s);return ps[i+1]?.textContent.trim();},symbol);
  if(!company)throw Error('Ticker lookup company missing');
  this.quoteDiagnostics.expectedCompany=company.slice(0,160);
  this.quoteDiagnostics.step='select_lookup_result';
  await this.clickText(symbol,'p');
  // Wait until the input retains the selected symbol and the lookup results close.
  this.quoteDiagnostics.step='wait_lookup_closed';
  await this.page.waitForFunction(s=>document.querySelector('#SymbolName')?.value.toUpperCase().split(/[\s(]/)[0]===s&&![...document.querySelectorAll('p')].some(e=>e.textContent.trim()===s),{timeout:10000},symbol);
  this.quoteDiagnostics.step='verify_selected_company';
  this.quoteDiagnostics.companyCandidates=await this.page.evaluate(()=>[...document.querySelectorAll('p')].map(e=>e.textContent.trim()).filter(s=>s.length<160&&/\b(INC|CORP|CORPORATION|TRUST|LTD|PLC|COMPANY|HOLDINGS)\b/i.test(s)).slice(0,8));
  await this.page.waitForFunction(c=>{const n=s=>s.toUpperCase().replace(/\b(COMMON STOCK|ORDINARY SHARES|UNIT|UNITS)\s*$/,'').replace(/[^A-Z0-9]/g,'');return [...document.querySelectorAll('p')].some(e=>n(e.textContent)===n(c));},{timeout:10000},company);
  await this.guard();
 }
 async quote(symbol,expectedDate) {
  await this.selectStock(symbol);
  // The company name can update before the dated price panel finishes loading.
  if(expectedDate) {
   this.quoteDiagnostics.step='wait_quote_date';
   try {
    await this.page.waitForFunction(date=>{
     const row=[...document.querySelectorAll('.stock-sub-row')].find(r=>r.querySelector('p')?.textContent.trim().startsWith('Last SMG Price'));
     const match=/\((\d{2})\/(\d{2})\/(\d{4})\)/.exec(row?.querySelector('p')?.textContent||'');
     return match&&`${match[3]}-${match[1]}-${match[2]}`===date;
    },{timeout:8000},expectedDate);
   } catch(error) {if(error.name!=='TimeoutError')throw error;}
   this.checkTime();
  }
  this.quoteDiagnostics.step='read_quote_values';
  const raw=await this.page.evaluate(()=>{
   function row(prefix) {
    const r=[...document.querySelectorAll('.stock-sub-row')].find(r=>r.querySelector('p')?.textContent.trim().startsWith(prefix));
    if(!r||r.lastElementChild?.tagName!=='P')throw Error('Quote layout changed');return {label:r.querySelector('p').textContent.trim(),value:r.lastElementChild.textContent.trim()};
   }
   return {current:row('Last SMG Price'),previous:row('Close Price'),cap:row('Market Cap (millions):')};
  });
  const date=/\((\d{2}\/\d{2}\/\d{4})\)/.exec(raw.current.label)?.[1];
  if(!date)throw Error('Quote date missing');
  return {price:money(raw.current.value),previous:money(raw.previous.value),date:isoDate(date),marketCap:money(raw.cap.value)*1e6};
 }
 async preview(order,date,budget) {
  await this.selectStock(order.symbol);
  await this.page.click({Buy:'#rbBuy',Sell:'#rbSell','Short Sell':'#rbShortSell','Short Cover':'#rbShortCover'}[order.action]);
  await this.page.type('#BuySellAmt',String(order.quantity));
  await this.clickText('Preview Trade','button');
  await this.page.waitForSelector('#TradePassword',{visible:true,timeout:15000});
  const preview=await this.page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.list01')].map(r=>[r.querySelector('.left strong')?.textContent.trim(),r.querySelector('.right')?.textContent.trim()]).filter(([k,v])=>k&&v)));
  verifyPreview(order,preview,date,budget);
  return preview;
 }
 // This branch is intentionally fenced until a remote read-only test succeeds.
 async submit(password) {
  this.checkTime();await this.page.type('#TradePassword',password);
  await this.clickText('Confirm Trade','.btnTradeBlue');
  await this.guard();
  // The caller independently verifies the new server confirmation in Pending Orders.
 }
}
