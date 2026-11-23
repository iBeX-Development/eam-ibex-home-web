import test from 'node:test';
import assert from 'node:assert/strict';
import {transferValue} from '../scripts/v88-transfer-values.mjs';
test('D1 costs reconcile with PostgreSQL REAL short-decimal output',()=>{
  for(const [source,postgres] of [[0.016316999999999998,0.016317],[0.000698,0.000698],[0.01022,0.01022]])
    assert.equal(transferValue('real',source),transferValue('real',postgres));
  assert.notEqual(transferValue('real',0.01),transferValue('real',0.02));
});
test('boolean conversion preserves nulls and textual content',()=>{
  assert.equal(transferValue('boolean',1),true);assert.equal(transferValue('boolean',0),false);
  assert.equal(transferValue('boolean',null),null);assert.equal(transferValue('text','001'), '001');
});
