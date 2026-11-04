/** Finite source-owner pure boundaries. No H authorization is fabricated and no
 * accepted scientific run, model load, provider or host.json mutation is made. */
import assert from 'node:assert/strict';
import {buildDeck,DEFAULT_RULES} from '@gd/engine';
import {referenceOf} from '../task-schema.mjs';
import {acceptDesignedSources,inspectDesignedCandidateSource,mergeDesignedSourceIndices} from '../designed-source-acceptance';
assert.deepEqual(process.argv.slice(2),['--case','source.designed-acceptance']);
const old={version:1,families:{root:{split:'train'},dev:{split:'dev'},sealed:{split:'sealed'},design:{split:'train',rootFamilyId:'root',parentFamilyIds:['root']}}};
const other={version:1,families:{older:{split:'dev'},root:{split:'train',rootFamilyId:'root',parentFamilyIds:[]}}};
const next=mergeDesignedSourceIndices(old,[other]);assert.deepEqual(next.families.dev,old.families.dev);assert.deepEqual(next.families.sealed,old.families.sealed);assert.deepEqual(next.families.root,old.families.root);assert.deepEqual(next.families.older,{split:'dev'});assert(!('older'in old.families));
assert.throws(()=>mergeDesignedSourceIndices(old,[{version:1,families:{dev:{split:'train'}}}]),/historical_family_conflict/);
assert.throws(()=>mergeDesignedSourceIndices(old,[{version:1,families:{design:{split:'train',rootFamilyId:'design',parentFamilyIds:[]}}}]),/historical_family_conflict/);
assert.throws(()=>mergeDesignedSourceIndices({version:1,families:{design:{split:'train',rootFamilyId:'root',parentFamilyIds:[]}}},[]),/family_edge/);
assert.throws(()=>mergeDesignedSourceIndices({version:1,families:{design:{split:'train',rootFamilyId:'root'}}},[]),/family_ownership/);
const source={schema:'ohuo-designed-first-game-source-v1',sourceKind:'designed-synthetic',questionId:'finite-owner-source',designFamilyId:'design',split:'train',engineSourceRef:referenceOf('finite-source',{baseCommit:'a'.repeat(40),files:[]}),rulesRef:referenceOf('finite-rules',DEFAULT_RULES),rules:DEFAULT_RULES,origin:{kind:'first-game',leaderSeed:1},initialIds:Array.from({length:4},(_,s)=>buildDeck().slice(s*27,(s+1)*27).map(c=>c.id)),moves:[],target:{gameNo:1,moveNo:0,actorSeat:0,remainingCards:[27,27,27,27]}};
const parsed=inspectDesignedCandidateSource(JSON.stringify(source));assert.match(parsed.sourceFamilyId,/^first-deal-family:[a-f0-9]{64}$/);assert.deepEqual(parsed.source,source);
const bad=structuredClone(source);bad.initialIds[0][0]=bad.initialIds[1][0];assert.throws(()=>inspectDesignedCandidateSource(JSON.stringify(bad)));
const copy=structuredClone(source);copy.questionId='renamed';assert.equal(inspectDesignedCandidateSource(JSON.stringify(copy)).sourceFamilyId,parsed.sourceFamilyId);
await assert.rejects(()=>acceptDesignedSources({host:{} as any,specRef:referenceOf('fake-spec',{})}),/original_host_required/);
console.log(JSON.stringify({caseId:'source.designed-acceptance',status:'passed',actualEngineInitialDeal:true,allPriorFamilyPreservation:true,callerHostRejected:true,providerRequests:0,modelLoads:0,teacherCalls:0,scientificRuns:0,hostCatalogMutations:0,originalHAdmission:false,actualCSourceReader:'separately named source.designed-first-game fixture, not replaced here'}));
