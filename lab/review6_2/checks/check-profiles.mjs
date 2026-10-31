/** B03 finite offline selectors; imports no listening server and never uses real credentials. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { taskOutput } from '../../../scripts/project-paths.mjs';
import { createProfileStore, ProfileError } from '../../../packages/web/server/llm-profiles.mjs';
import { createProfileRoutes } from '../../../packages/web/server/llm-profile-routes.mjs';
import { fakeOnlyStore } from './profiles-manual-server.mjs';
import { createProfileClient } from '../../../packages/web/src/game/llm-profiles.ts';

const fixturePath = new URL('./fixtures/profiles.fake.json', import.meta.url);
const fixtureBytes = readFileSync(fixturePath);
const fixtures = JSON.parse(fixtureBytes).profiles;
mkdirSync(new URL('../../out/', import.meta.url),{recursive:true});
const root = taskOutput('profiles-check','B03');
mkdirSync(root,{recursive:true});
const temp = mkdtempSync(join(root,'profiles-fixture-'));
const file = join(temp, 'fake-private.json');
const store = createProfileStore({ filePath: file });
const fake = i => structuredClone(fixtures[i]);
function save(i) { return store.save({ profile: fake(i), expectedRevision: null }); }
function memory() {
  const data = new Map(); const reads = [];
  return { data, reads, getItem(k) { reads.push(k); return data.get(k) ?? null; }, setItem(k,v) { data.set(k,v); }, removeItem(k) { data.delete(k); } };
}
function mockFetch(handler) { return async (_url, init) => ({ ok: true, status: 200, json: async () => handler(init) }); }
function request({method='GET', origin='http://localhost:5180', remoteAddress='127.0.0.1', host='127.0.0.1:8787', body, contentType='application/json'}={}) {
  return { method, url:'/api/llm-profiles', socket:{remoteAddress}, headers:{host,origin,'content-type':contentType,'sec-fetch-site':'same-origin'}, async *[Symbol.asyncIterator]() { if(body) yield Buffer.from(JSON.stringify(body)); } };
}
function response() { return { status:0, body:'', headers:{}, writeHead(status,headers) {this.status=status; Object.assign(this.headers,headers); return this;}, end(body='') {this.body=body; return this;} }; }
const cases = {
  async 'two-profile-roundtrip'() {
    const a = save(0); const b = save(1);
    assert.equal(a.revision,1); assert.equal(b.revision,1);
    const beforeB = store.resolve({profileId:b.profileId,revision:b.revision,snapshotHash:b.snapshotHash});
    const next = store.save({profile:{...fake(0),requestedModel:'fake-glm-model-updated'},expectedRevision:a.revision,expectedSnapshotHash:a.snapshotHash});
    assert.equal(next.revision,2); assert.notEqual(next.snapshotHash,a.snapshotHash);
    assert.deepEqual(store.resolve({profileId:b.profileId,revision:b.revision,snapshotHash:b.snapshotHash}),beforeB);
    assert.equal(store.resolve({profileId:next.profileId,revision:next.revision,snapshotHash:next.snapshotHash}).secret,fixtures[0].secret);
    assert.throws(()=>store.resolve({profileId:a.profileId,revision:a.revision,snapshotHash:a.snapshotHash}),/revision_conflict/);
    assert.throws(()=>store.save({profile:fake(0),expectedRevision:1,expectedSnapshotHash:a.snapshotHash}),/revision_conflict/);
    assert.throws(()=>store.save({profile:{...fake(0),profileId:'partial',secret:undefined},expectedRevision:null}),/secret_required/);
    const again = createProfileStore({filePath:file});
    assert.deepEqual(again.list(), store.list());
    const withoutSecret = fake(0); delete withoutSecret.secret;
    const retained = store.save({profile:{...withoutSecret,requestedModel:'fake-glm-keep-key'},expectedRevision:next.revision,expectedSnapshotHash:next.snapshotHash});
    assert.equal(store.resolve({profileId:retained.profileId,revision:retained.revision,snapshotHash:retained.snapshotHash}).secret,fixtures[0].secret);
    assert.deepEqual(store.resolve({profileId:b.profileId,revision:b.revision,snapshotHash:b.snapshotHash}),beforeB);
    assert.throws(()=>store.resolve({profileId:b.profileId,revision:retained.revision,snapshotHash:retained.snapshotHash}),/revision_conflict/);
    const frozen = store.resolve({profileId:b.profileId,revision:b.revision,snapshotHash:b.snapshotHash});
    frozen.requestOptions.reasoning_effort='high'; assert.equal(store.resolve({profileId:b.profileId,revision:b.revision,snapshotHash:b.snapshotHash}).requestOptions.reasoning_effort,'low');

    const mem = memory(); const client = createProfileClient({storage:mem,fetchImpl:mockFetch(()=>store.list())});
    assert.deepEqual(await client.refresh(),store.list());
    assert.deepEqual(client.cached(),store.list());
  },
  async 'secret-redaction'() {
    const a=save(0); save(1);
    const publicText=JSON.stringify(store.list());
    for(const f of fixtures) assert.ok(!publicText.includes(f.secret));
    assert.ok(!publicText.includes('"secret"'));
    assert.equal(statSync(file).mode & 0o777,0o600);
    const rotated=store.save({profile:{...fake(0),secret:'FAKE_ROTATED_ONLY'},expectedRevision:a.revision,expectedSnapshotHash:a.snapshotHash});
    assert.deepEqual(rotated,a);
    assert.equal(store.resolve({profileId:a.profileId,revision:a.revision,snapshotHash:a.snapshotHash}).credentialRevision,2);
    assert.throws(()=>store.save({profile:{...fake(1),baseUrl:'https://user:FAKE_SECRET@invalid.example'},expectedRevision:1}),/invalid_base_url/);
    const client=createProfileClient({storage:memory(),fetchImpl:mockFetch(()=>[{...a,secret:fixtures[0].secret}])});
    await assert.rejects(()=>client.refresh(),/invalid_public_profile/);
    const hostileError=createProfileClient({storage:memory(),fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:'fake_lowercase_secret'})})});
    await assert.rejects(()=>hostileError.refresh(),e=>e.message==='profile_save_failed');
    const leak = fake(1); leak.nickname=leak.secret;
    assert.throws(()=>store.save({profile:leak,expectedRevision:1,expectedSnapshotHash:store.list()[1].snapshotHash}),/secret_in_public_fields/);
    chmodSync(file,0o644); const unsafeBytes=readFileSync(file,'utf8');
    assert.throws(()=>store.list(),/private_store_requires_0600_regular_file/);
    assert.equal(readFileSync(file,'utf8'),unsafeBytes); assert.equal(statSync(file).mode&0o777,0o644);
    chmodSync(file,0o600);
    writeFileSync(file,'{broken', {mode:0o600});
    assert.throws(()=>store.list(),/invalid_private_store/);
  },
  async 'unsupported-option'() {
    for (const profile of [
      {...fake(0),requestOptions:{reasoning_effort:'high'}},
      {...fake(1),requestOptions:{reasoning_effort:'max'}},
      {...fake(1),requestOptions:{unknown_option:true}},
      {...fake(1),supportedReasoningOptions:{effort:['high']}},
      {...fake(1),protocol:'brand-auto'},
      {...fake(1),requestOptions:{thinking:{type:'enabled',ignored:1}}},
      {...fake(1),unexpected:fixtures[0].secret},
      {...fake(0),requestOptions:{}},
      {...fake(0),requestOptions:{max_tokens:2048,thinking:{type:'enabled',budget_tokens:4096}}},
      {...fake(1),baseUrl:'http://remote.invalid/v1'},
      {...fake(1),baseUrl:'https://api.invalid/v1?api_key=FAKE_ONLY'},
      {...fake(1),supportedReasoningOptions:{}},
      {...fake(1),requestedModel:''},

    ]) {
      assert.throws(()=>store.save({profile,expectedRevision:null}),e=>e instanceof ProfileError && !e.message.includes(fixtures[0].secret));
    }
    assert.deepEqual(store.list(),[]);
  },
  async 'legacy-explicit-import'() {
    const mem=memory();
    mem.setItem('gd_llm_config',JSON.stringify({baseUrl:'https://legacy.invalid/v1',apiKey:'FAKE_LEGACY_ONLY',model:'fake-legacy',effort:'max'}));
    const original=mem.data.get('gd_llm_config');
    const client=createProfileClient({storage:mem,fetchImpl:mockFetch(init=>init?.method==='POST'?store.save(JSON.parse(init.body)):store.list())});
    client.cached(); await client.refresh();
    assert.ok(!mem.reads.includes('gd_llm_config'));
    const legacy=client.readLegacyForExplicitImport();
    assert.equal(legacy.secret,'FAKE_LEGACY_ONLY'); assert.equal(legacy.requestedModel,'fake-legacy');
    assert.equal(legacy.legacyEffort,'max'); assert.equal(legacy.protocol,undefined);
    const saved=await client.save({profile:{...fake(0),secret:legacy.secret},expectedRevision:null});
    assert.equal(saved.profileId,'fixture-glm');
    assert.equal(mem.data.get('gd_llm_config'),original);
    for(const [key,value] of mem.data) if(key!=='gd_llm_config') assert.ok(!value.includes('FAKE_LEGACY_ONLY'));
    const failing=createProfileClient({storage:mem,fetchImpl:async()=>{throw Error('offline');}});
    await assert.rejects(()=>failing.save({profile:fake(1),expectedRevision:null}),/profile_service_unavailable/);
    assert.equal(mem.data.get('gd_llm_config'),original);
    mem.setItem('gd_llm_config',JSON.stringify({baseUrl:'https://legacy.invalid/v1',apiKey:'FAKE_LEGACY_ONLY',model:'fake',effort:'unsupported'}));
    assert.throws(()=>client.readLegacyForExplicitImport(),/invalid_legacy_config/);
    const mismatch=createProfileClient({storage:memory(),fetchImpl:mockFetch(()=>saved)});
    await assert.rejects(()=>mismatch.save({profile:fake(1),expectedRevision:null}),/profile_response_mismatch/);
  },
  async 'local-only-route'() {
    const guarded=fakeOnlyStore(store,fixtures);
    assert.throws(()=>guarded.save({profile:{...fake(0),secret:'NOT_A_FIXTURE_KEY'},expectedRevision:null}),/fixture_only/);
    assert.throws(()=>guarded.save({profile:{...fake(0),baseUrl:'https://real.example/v1'},expectedRevision:null}),/fixture_only/);
    const route=createProfileRoutes({store});
    for(const bad of [{origin:'https://evil.example'},{remoteAddress:'192.0.2.1'},{host:'evil.example:8787'}, {origin:'http://localhost:9999'}]) {
      const res=response(); await route(request({...bad,method:'POST',body:{profile:fake(0),expectedRevision:null}}),res); assert.equal(res.status,403);
    }
    const nonJson=response();await route(request({method:'POST',contentType:'text/plain',body:{profile:fake(0),expectedRevision:null}}),nonJson);assert.equal(nonJson.status,415);
    const res=response();await route(request({method:'POST',body:{profile:fake(0),expectedRevision:null}}),res);assert.equal(res.status,200); assert.ok(!res.body.includes(fixtures[0].secret));
    const read=response();await route(request(),read);assert.equal(read.status,200);assert.deepEqual(JSON.parse(read.body),store.list());
    const bad=response();await route(request({method:'POST',body:{profile:{...fake(1),requestOptions:{oops:fixtures[1].secret}},expectedRevision:null}}),bad);assert.equal(bad.status,400);assert.ok(!bad.body.includes(fixtures[1].secret));
    assert.equal(read.headers['access-control-allow-origin'],undefined);
    const absentOrigin=request({method:'POST',body:{profile:fake(1),expectedRevision:null}});delete absentOrigin.headers.origin;
    const noOrigin=response();await route(absentOrigin,noOrigin);assert.equal(noOrigin.status,403);
    const unrelated=request();unrelated.url='/api/chat';assert.equal(await route(unrelated,response()),false);
    const unsupported=response();await route(request({method:'DELETE'}),unsupported);assert.equal(unsupported.status,405);

  },
};
try {
  const args=process.argv.slice(2); if(args.length!==2 || args[0]!=='--case' || !Object.hasOwn(cases,args[1])) throw Error('Expected exactly --case <registered B03 case>');
  await cases[args[1]]();
  console.log(JSON.stringify({caseId:args[1],status:'passed',fixtureSHA256:createHash('sha256').update(fixtureBytes).digest('hex'),scope:'offline fake profiles; no server listen/network/real secrets'}));
} catch(error) { console.error(JSON.stringify({status:'failed',error:error.message})); process.exitCode=1; }
finally { rmSync(temp,{recursive:true,force:true}); }
