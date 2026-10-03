// Only explicitly approved diagnostics leave the private D1 journal.
export function publicReport(report) {
 const allowed=['mode','date','status','stage','errorCode','durationMs','externalDataConfigured','snapshotDates','quoteChecks','marketAnalysis','warnings'];
 const out=Object.fromEntries(allowed.filter(k=>report[k]!==undefined).map(k=>[k,report[k]]));
 if(report.diagnostics) {
  const keys=['step','pages','rows','columnCounts','loginFormPresent','tradeTypePresent','credentialsRejected','verificationPresent','accountIdentityVerified','expectedCompany','companyCandidates'];
  out.diagnostics=Object.fromEntries(keys.filter(k=>report.diagnostics[k]!==undefined).map(k=>[k,report.diagnostics[k]]));
 }
 if(report.runs)out.runs=report.runs.map(r=>({status:r.status,started:r.started,finished:r.finished,report:r.report?publicReport(r.report):null}));
 out.orderCounts={planned:report.orders?.length||0,blocked:report.blockedOrders?.length||0,accepted:report.orders?.filter(o=>o.confirmation).length||0};
 return out;
}
