// Experimental strategy, not a proven source of excess returns.
export const DEFAULTS = Object.freeze({
 maxPosition: .18, maxGross: 1.10, maxShortGross: .25,
 longLoss: .18, shortLoss: .12, targetPosition: .10,
 maxOrders: 3, reserveFraction: .10, fee: 5, buffer: .04,
 minHistory: 21, entryMomentum: .04,
});

export function money(raw) {
 const s=String(raw).trim();
 if (!/^[-+]?\(?\$?[-+]?\d[\d,]*(?:\.\d+)?\)?(?:\s*%)?$/.test(s)) throw Error('Invalid monetary value');
 const n=Number(s.replace(/[$,%()\s]/g,''));
 if (!Number.isFinite(n)) throw Error('Nonfinite monetary value');
 return s.includes('(')?-Math.abs(n):n;
}
export function isoDate(us) {
 const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(us);
 if(!m) throw Error('Invalid account date');
 return `${m[3]}-${m[1]}-${m[2]}`;
}
export function localClock(now) {
 // This application is limited to the 2026 competition. Avoid cold Intl
 // initialization on a Worker with a very small free CPU budget.
 const ms=now.getTime();
 if(!Number.isFinite(ms)||now.getUTCFullYear()!==2026)throw Error('Unsupported calendar year');
 const daylight=ms>=Date.parse('2026-03-08T07:00:00Z')&&ms<Date.parse('2026-11-01T06:00:00Z');
 const d=new Date(ms-(daylight?4:5)*3600000);
 return {date:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes(),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]};
}
export function tradingWindow(now, end='2026-12-04') {
 const c=localClock(now);
 // This calendar is deliberately restricted to the verified 2026 game.
 if(c.date<'2026-09-08'||c.date>end||c.date>'2026-12-04'||['Sat','Sun'].includes(c.weekday)||c.date==='2026-11-26') return {...c,allowed:false};
 const close=c.date==='2026-11-27'?13*60:16*60;
 return {...c,allowed:c.minute>=close-100&&c.minute<=close-75};
}

export function snapshotDateAllowed(snapshotDate,now,diagnostic=false) {
 const clock=localClock(now),utcDate=now.toISOString().slice(0,10);
 return snapshotDate===clock.date||Boolean(diagnostic&&clock.minute>=960&&utcDate>clock.date&&snapshotDate===utcDate);
}

export function aggregate(lots) {
 const out=new Map();
 for(const l of lots) {
  if(l.asset==='bond') continue;
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(l.symbol)||!['Long','Short'].includes(l.side)||!Number.isInteger(l.shares)||l.shares===0||!(l.price>0)||!Number.isFinite(l.price)||!Number.isFinite(l.cost)) throw Error('Invalid position');
  if((l.side==='Short')!==(l.shares<0)) throw Error('Position direction mismatch');
  let p=out.get(l.symbol);
  if(p&&(p.side!==l.side||Math.abs(p.price/l.price-1)>.001)) throw Error('Inconsistent position lots');
  if(!p) out.set(l.symbol,p={symbol:l.symbol,side:l.side,shares:0,cost:0,price:l.price});
  p.shares+=l.shares; p.cost+=Math.abs(l.cost);
 }
 return [...out.values()].map(p=>({...p,notional:Math.abs(p.shares)*p.price,pnl:p.side==='Long'?Math.abs(p.shares)*p.price-p.cost:p.cost-Math.abs(p.shares)*p.price}));
}

export function signal(prices, cfg=DEFAULTS) {
 if(!Array.isArray(prices)||prices.length<cfg.minHistory||prices.some(p=>!Number.isFinite(p)||p<=0)) return null;
 const last=prices.at(-1), slow=prices.slice(-20).reduce((a,b)=>a+b,0)/20;
 const fast=prices.slice(-5).reduce((a,b)=>a+b,0)/5;
 const momentum=last/prices.at(-21)-1;
 const daily=prices.slice(-20).map((p,i)=>p/prices[prices.length-21+i]-1);
 const mean=daily.reduce((a,b)=>a+b,0)/daily.length;
 const vol=Math.sqrt(daily.reduce((a,b)=>a+(b-mean)**2,0)/daily.length);
 // Thresholds are configurable engineering defaults, not optimized promises.
 return {side:last>slow&&fast>slow&&momentum>cfg.entryMomentum?'Long':last<slow&&fast<slow&&momentum<-cfg.entryMomentum?'Short':null,momentum,vol};
}

export function plan(account,lots,pending,quotes,histories,cfg=DEFAULTS) {
 if(!(account.equity>0)||!Number.isFinite(account.buyingPower)||!Number.isFinite(account.cash)) throw Error('Invalid account summary');
 const positions=aggregate(lots), orders=[], warnings=[];
 const busy=new Set(pending.map(o=>o.symbol));
 let gross=positions.reduce((a,p)=>a+p.notional,0);
 let shortGross=positions.filter(p=>p.side==='Short').reduce((a,p)=>a+p.notional,0);
 const reserve=cfg.reserveFraction*account.equity;
 // No credit from planned exits; only confirmed buying power can fund entries.
 let budget=Math.max(0,account.buyingPower-reserve);
 const exits=[];
 for(const p of positions) {
  if(busy.has(p.symbol)) {warnings.push(`${p.symbol}: pending order, no additional trade`);continue;}
  const loss=p.cost>0?p.pnl/p.cost:0;
  const s=signal(histories[p.symbol],cfg);
  let qty=0,reason='';
  if(loss<=-(p.side==='Long'?cfg.longLoss:cfg.shortLoss)) {qty=Math.abs(p.shares);reason='Loss threshold';}
  else if(s?.side&&s.side!==p.side) {qty=Math.abs(p.shares);reason='Trend reversed';}
  else if(p.notional>account.equity*cfg.maxPosition) {qty=Math.ceil((p.notional-account.equity*cfg.maxPosition)/p.price);reason='Position concentration';}
  if(qty>0) exits.push({symbol:p.symbol,action:p.side==='Long'?'Sell':'Short Cover',quantity:Math.min(qty,Math.abs(p.shares)),referencePrice:p.price,reason,priority:loss});
 }
 // Exposure limits never assume an unfilled exit has reduced exposure.
 exits.sort((a,b)=>a.priority-b.priority||a.symbol.localeCompare(b.symbol));
 for(const e of exits) if(orders.length<cfg.maxOrders) orders.push(e);
 if(gross>account.equity*cfg.maxGross) {
  warnings.push('Gross exposure exceeds configured limit; openings blocked');
  if(orders.length===0) {
   const p=positions.filter(p=>!busy.has(p.symbol)).sort((a,b)=>b.notional-a.notional)[0];
   if(p) orders.push({symbol:p.symbol,action:p.side==='Long'?'Sell':'Short Cover',quantity:Math.min(Math.abs(p.shares),Math.ceil((gross-account.equity*cfg.maxGross)/p.price)),referencePrice:p.price,reason:'Gross exposure reduction'});
  }
 }
 if(orders.length) return {orders,warnings,gross,budget};
 const occupied=new Set(positions.map(p=>p.symbol));
 const candidates=[];
 for(const [symbol,q] of Object.entries(quotes)) {
  if(busy.has(symbol)||occupied.has(symbol)||q.date!==account.quoteDate||q.previous<3||q.price<3||q.marketCap<25e6||!Number.isFinite(q.marketCap)||!(q.price>0)) continue;
  const h=histories[symbol],s=signal(h,cfg);
  if(!s?.side||!h?.length||Math.abs(h.at(-1)/q.price-1)>.03) continue;
  candidates.push({symbol,q,s});
 }
 candidates.sort((a,b)=>Math.abs(b.s.momentum)-Math.abs(a.s.momentum)||a.symbol.localeCompare(b.symbol));
 for(const {symbol,q,s} of candidates) {
  if(orders.length>=cfg.maxOrders) break;
  const room=Math.max(0,account.equity*cfg.maxGross-gross);
  const shortRoom=s.side==='Short'?Math.max(0,account.equity*cfg.maxShortGross-shortGross):Infinity;
  const notional=Math.min(cfg.targetPosition*account.equity,room,shortRoom,(budget-cfg.fee)/(1+cfg.buffer));
  const qty=Math.floor(notional/q.price);
  if(qty<10) continue;
  orders.push({symbol,action:s.side==='Long'?'Buy':'Short Sell',quantity:qty,referencePrice:q.price,reason:'20-session momentum and trend alignment'});
  budget-=qty*q.price*(1+cfg.buffer)+cfg.fee;
  gross+=qty*q.price;if(s.side==='Short')shortGross+=qty*q.price;
 }
 if(candidates.length===0) warnings.push('No eligible entry signal. Cold start needs 21 daily observations or validated historical seed data.');
 return {orders,warnings,gross,budget};
}

export function verifyPreview(order, preview, currentDate, remainingBudget=Infinity) {
 if(preview.Action!==order.action||preview.Ticker!==order.symbol||money(preview['# Of Shares'])!==order.quantity||preview['Order Type']!=='Market Order') throw Error('Trade preview does not match intended order');
 if(isoDate(preview['Last Known SMG Price Date'])!==currentDate) throw Error('Stale trade preview');
 const price=money(preview['Last Known SMG Price*']);
 if(!(price>0)||Math.abs(price/order.referencePrice-1)>.05) throw Error('Trade preview price discrepancy');
 if(['Buy','Short Sell'].includes(order.action)) {
  if(money(preview['Estimated Buying Power After Trade'])<0) throw Error('Insufficient buying power in preview');
  if(price*order.quantity*1.04+5>remainingBudget) throw Error('Preview exceeds reserved opening budget');
 }
 return true;
}
