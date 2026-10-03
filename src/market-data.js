import {localClock} from './core.js';
const HOST='https://data.alpaca.markets';
export function validTrade(trade,now) {
 const ms=Date.parse(trade?.t),age=now.getTime()-ms;
 if(!Number.isFinite(ms)||!Number.isFinite(trade?.p)||trade.p<=0||age< -1000||age>300000)return null;
 const c=localClock(new Date(ms)),today=localClock(now);
 if(c.date!==today.date||c.minute<570||c.minute>=960)return null;
 return {price:trade.p,date:c.date,source:'alpaca_iex',timestamp:trade.t};
}
export function priorCloses(bars,today) {
 const dates=new Map();
 for(const b of bars||[]) {
  const date=String(b.t||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>=today||!Number.isFinite(b.c)||b.c<=0)continue;
  if(dates.has(date))throw Error('Duplicate external daily bar');
  dates.set(date,b.c);
 }
 return [...dates].sort(([a],[b])=>a.localeCompare(b)).slice(-128).map(([,price])=>price);
}
export async function marketData(env,symbols,now=new Date(),fetcher=fetch) {
 if(env.MARKET_DATA_PROVIDER==='none')return null;
 if(!env.MARKET_DATA_KEY||!env.MARKET_DATA_SECRET)return publicMarketData(env,symbols,now,fetcher);
 if(symbols.length>20||symbols.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw Error('Invalid external data symbols');
 const headers={'APCA-API-KEY-ID':env.MARKET_DATA_KEY,'APCA-API-SECRET-KEY':env.MARKET_DATA_SECRET};
 async function get(path,params) {
  const url=new URL(path,HOST);url.search=new URLSearchParams(params).toString();
  const response=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('External market data request rejected');
  return response.json();
 }
 const today=localClock(now).date;
 const start=new Date(now.getTime()-230*86400000).toISOString().slice(0,10);
 const params={symbols:symbols.join(','),feed:'iex'};
 const [trades,intraday,first]=await Promise.all([
  get('/v2/stocks/trades/latest',params),
  get('/v2/stocks/bars',{...params,timeframe:'5Min',start:today,end:now.toISOString(),adjustment:'split',limit:'10000',sort:'asc'}).then(r=>{if(r.next_page_token)throw Error('Intraday history truncated');return r;}),
  get('/v2/stocks/bars',{...params,timeframe:'1Day',start,end:today,adjustment:'split',limit:'10000',sort:'asc'}),
 ]);
 const bars={};let result=first;
 for(let page=0;page<3;page++) {
  for(const symbol of symbols)bars[symbol]=(bars[symbol]||[]).concat(result.bars?.[symbol]||[]);
  if(!result.next_page_token)break;
  if(page===2)throw Error('External history pagination exceeded');
  result=await get('/v2/stocks/bars',{...params,timeframe:'1Day',start,end:today,adjustment:'split',limit:'10000',sort:'asc',page_token:result.next_page_token});
 }
 return Object.fromEntries(symbols.map(symbol=>[symbol,{quote:validTrade(trades.trades?.[symbol],now),history:priorCloses(bars[symbol],env.MARKET_DATA_AS_OF_DATE||today),intraday:regularBars(intraday.bars?.[symbol],now)}]));
}

export function regularBars(bars,now,today=localClock(now).date) {
 const seen=new Set();
 return (bars||[]).filter(b=>{
  const ms=Date.parse(b.t);if(!Number.isFinite(ms)||ms+300000>now.getTime())return false;
  const c=localClock(new Date(ms));
  if(c.date!==today||c.minute<570||c.minute>=960||![b.o,b.h,b.l,b.c].every(p=>Number.isFinite(p)&&p>0))return false;
  if(seen.has(ms))throw Error('Duplicate intraday bar');seen.add(ms);return true;
 }).sort((a,b)=>Date.parse(a.t)-Date.parse(b.t)).map(b=>({time:b.t,open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v}));
}
export function trendSummary(history,price) {
 if(!Array.isArray(history)||history.some(p=>!Number.isFinite(p)||p<=0)||!Number.isFinite(price)||price<=0)return null;
 const returns={};
 for(const [label,sessions] of [['1d',1],['5d',5],['1mo',21],['3mo',63],['6mo',126]])
  returns[label]=history.length>=sessions?price/history.at(-sessions)-1:null;
 const average=n=>history.length+1>=n?history.concat(price).slice(-n).reduce((a,b)=>a+b,0)/n:null;
 return {returns,averages:{sma5:average(5),sma20:average(20),sma50:average(50)},historySessions:history.length};
}

// Public personal-use chart data needs no account. A rejected request is never
// retried through another host, proxy, cookie flow or browser fingerprint.
export function chartData(payload,symbol) {
 const r=payload?.chart?.result;
 if(payload?.chart?.error||r?.length!==1)throw Error('Public chart unavailable');
 const chart=r[0],meta=chart.meta;
 if(meta?.symbol!==symbol||meta.currency!=='USD'||!['EQUITY','ETF'].includes(meta.instrumentType)||meta.exchangeTimezoneName!=='America/New_York')throw Error('Public chart identity mismatch');
 const q=chart.indicators?.quote;
 if(q?.length!==1||!Array.isArray(chart.timestamp))throw Error('Public chart layout changed');
 const bars=chart.timestamp.map((t,i)=>({t:new Date(t*1000).toISOString(),o:q[0].open?.[i],h:q[0].high?.[i],l:q[0].low?.[i],c:q[0].close?.[i],v:q[0].volume?.[i]}));
 return {meta,bars};
}
export async function publicMarketData(env,symbols,now,fetcher) {
 if(symbols.length>20||symbols.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw Error('Invalid external data symbols');
 const asOf=env.MARKET_DATA_AS_OF_DATE||localClock(now).date;
 const signal=AbortSignal.timeout(45000),out={};let index=0;
 async function get(symbol,interval,range) {
  const url=new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`,'https://query1.finance.yahoo.com');
  url.search=new URLSearchParams({interval,range,includePrePost:'false',events:'splits'}).toString();
  const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),redirect:'error'});
  if(!response.ok)throw Error('Public chart request rejected');
  return chartData(await response.json(),symbol);
 }
 async function work() {
  while(index<symbols.length&&!signal.aborted) {
   const symbol=symbols[index++];
   try {
    const [daily,intraday]=await Promise.all([get(symbol,'1d','1y'),get(symbol,'5m','1d')]);
    const raw=validTrade({p:intraday.meta.regularMarketPrice,t:new Date(intraday.meta.regularMarketTime*1000).toISOString()},now);
    const completed=daily.bars.find(b=>b.t.slice(0,10)===asOf&&Number.isFinite(b.c)&&b.c>0);
    out[symbol]={analysisPrice:raw?.price||completed?.c,quote:raw?{...raw,source:'yahoo_public'}:null,history:priorCloses(daily.bars,asOf),intraday:regularBars(intraday.bars,now,asOf),source:'yahoo_public'};
   } catch {out[symbol]={quote:null,history:[],intraday:[],source:'yahoo_public',unavailable:true};}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,symbols.length)},work));
 if(!Object.values(out).some(d=>d.history.length))throw Error('Public market data unavailable');
 return out;
}
