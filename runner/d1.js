export class RemoteD1 {
 constructor(account,database,token,fetcher=fetch) {
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!/^[-a-f0-9]{36}$/i.test(database||'')||!token)throw Error('D1 credentials not configured');
  this.url=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  this.token=token;this.fetcher=fetcher;
 }
 prepare(sql) {
  const db=this;
  function statement(params=[]) {
   async function execute() {
    const response=await db.fetcher(db.url,{method:'POST',headers:{Authorization:`Bearer ${db.token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params:params.map(value=>value===null?null:String(value))}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('D1 API request rejected');
    const body=await response.json(),result=body.result?.[0];
    if(!body.success||result?.success!==true)throw Error('D1 query failed');
    return result;
   }
   return {bind:(...args)=>statement(args),run:execute,all:execute,first:async column=>{const row=(await execute()).results?.[0];return column?row?.[column]??null:row??null;}};
  }
  return statement();
 }
}
