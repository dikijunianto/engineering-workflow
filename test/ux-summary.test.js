import test from 'node:test';
import assert from 'node:assert/strict';
import {roomSummary,roomGroups} from '../ui/model.js';
test('Room extracts saved summaries and retains grouping without modifying history',()=>{
 assert.equal(roomSummary('{"summary":"Waiting for input","raw":123}'),'Waiting for input');
 assert.equal(roomSummary('{"tool_calls":[]}'),'Structured agent output — expand for details.');
 assert.equal(roomSummary('**Compile failed**\nmissing method'),'Compile failed missing method');
 assert.equal(roomSummary('a'.repeat(400)).length,281);
 assert.equal(roomSummary('partial report...","blocking":false},{"severity":"HIGH"}'),'Saved structured output — expand for details.');
 const entries=[{id:'1',runId:'a',createdAt:'2026-01-01'}, {id:'2',runId:'b',createdAt:'2026-01-02'}, {id:'3',runId:'a',createdAt:'2026-01-03'}];
 const before=JSON.stringify(entries),groups=roomGroups(entries);
 assert.deepEqual(groups.map(g=>g.id),['a','b']);
 assert.deepEqual(groups[0].entries.map(e=>e.id),['1','3']);
 assert.equal(JSON.stringify(entries),before);
});

import {currentAttentionRuns} from '../ui/model.js';
test('completed tasks and PR handoffs do not advertise historical failures as current blockers',()=>{
 const state={quests:[{id:'q',state:'EXECUTING'}],tasks:[{id:'t',state:'COMPLETED'}],runs:[{id:'r',questId:'q',purpose:'v11-task',taskId:'t',state:'FAILED'}]};
 assert.equal(currentAttentionRuns(state).length,0);
 state.tasks[0].state='NEEDS_HUMAN_ATTENTION';
 assert.equal(currentAttentionRuns(state).length,1);
 state.quests[0].state='PRS_CREATED';
 assert.equal(currentAttentionRuns(state).length,0);
 state.runs[0].state='WAITING_INPUT';
 assert.equal(currentAttentionRuns(state).length,1);
});
