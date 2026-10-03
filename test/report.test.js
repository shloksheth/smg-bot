import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReport} from '../runner/report.js';
test('public diagnostics omit account balances, position sizes, preview budgets and confirmations',()=>{
 const input={status:'previews_verified',account:{cash:987654},positions:[{shares:876543}],pending:[{confirmation:'private-confirmation'}],orders:[{quantity:765432,confirmation:'private-confirmation',preview:{budget:654321}}],diagnostics:{step:'reconcile_holdings',totals:{long:543210}},runs:[{report:{account:{cash:987654}}}]};
 const result=publicReport(input),text=JSON.stringify(result);
 for(const secret of ['987654','876543','765432','654321','543210','private-confirmation'])assert.ok(!text.includes(secret));
 assert.equal(result.orderCounts.accepted,1);assert.equal(result.diagnostics.step,'reconcile_holdings');
});
