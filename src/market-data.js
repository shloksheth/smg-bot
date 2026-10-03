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
  if(!/^2026-\d{2}-\d{2}$/.test(date)||date>=today||!Number.isFinite(b.c)||b.c<=0)continue;
  if(dates.has(date))throw Error('Duplicate external daily bar');
  dates.set(date,b.c);
 }
 return [...dates].sort(([a],[b])=>a.localeCompare(b)).slice(-64).map(([,price])=>price);
}
export async function marketData(env,symbols,now=new Date(),fetcher=fetch) {
 if(!env.MARKET_DATA_KEY||!env.MARKET_DATA_SECRET)return null;
 if(symbols.length>20||symbols.some(s=>!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))throw Error('Invalid external data symbols');
 const headers={'APCA-API-KEY-ID':env.MARKET_DATA_KEY,'APCA-API-SECRET-KEY':env.MARKET_DATA_SECRET};
 async function get(path,params) {
  const url=new URL(path,HOST);url.search=new URLSearchParams(params).toString();
  const response=await fetcher(url,{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('External market data request rejected');
  return response.json();
 }
 const today=localClock(now).date;
 const start=new Date(now.getTime()-100*86400000).toISOString().slice(0,10);
 const params={symbols:symbols.join(','),feed:'iex'};
 const [trades,first]=await Promise.all([
  get('/v2/stocks/trades/latest',params),
  get('/v2/stocks/bars',{...params,timeframe:'1Day',start,end:today,adjustment:'split',limit:'10000',sort:'asc'}),
 ]);
 const bars={};let result=first;
 for(let page=0;page<3;page++) {
  for(const symbol of symbols)bars[symbol]=(bars[symbol]||[]).concat(result.bars?.[symbol]||[]);
  if(!result.next_page_token)break;
  if(page===2)throw Error('External history pagination exceeded');
  result=await get('/v2/stocks/bars',{...params,timeframe:'1Day',start,end:today,adjustment:'split',limit:'10000',sort:'asc',page_token:result.next_page_token});
 }
 return Object.fromEntries(symbols.map(symbol=>[symbol,{quote:validTrade(trades.trades?.[symbol],now),history:priorCloses(bars[symbol],today)}]));
}
