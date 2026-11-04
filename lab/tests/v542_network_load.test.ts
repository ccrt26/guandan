import {afterEach,expect,it,vi} from 'vitest';
vi.mock('node:fs',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs')>();return {...actual,readFileSync:vi.fn(actual.readFileSync)};});
import {mkdtempSync,realpathSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {MLP} from '../../packages/ai/src/nn/mlp';
import {NeuralDecider} from '../../packages/ai/src/nn/neuralSeat';
import {createMatch,startGame,DEFAULT_RULES} from '@gd/engine';
import {driverFor,type PolicySpec} from '../review6/match-play';
const encoder={schema:'v2',ctxFill:'rule-context',passEncoding:'action64'} as const;
function fixture(seed:number){const directory=mkdtempSync(join(realpathSync(tmpdir()),'v542-network-')),weights=new MLP(seed,399).getWeights(),bytes=Buffer.from(weights.buffer),path=join(directory,'synthetic.f32');writeFileSync(path,bytes);const spec:PolicySpec={policyId:'synthetic-'+seed,kind:'neural',weightsPath:path,weightsSHA256:createHash('sha256').update(bytes).digest('hex'),inputDim:399,encoder,epsilon:0};return {directory,path,spec,weights,bytes};}
afterEach(()=>vi.restoreAllMocks());
it('uses one cold read for hash and loaded weights, and rejects changed bytes on hot use',async()=>{
 const f=fixture(543),actual=await vi.importActual<typeof import('node:fs')>('node:fs'),read=vi.mocked(readFileSync),changed=Buffer.from(f.bytes);changed.writeFloatLE(changed.readFloatLE(0)+1,0);let reads=0;
 read.mockImplementation(((...args:any[])=>{const result=(actual.readFileSync as any)(...args);if(args[0]===f.path&&++reads===1)writeFileSync(f.path,changed);return result;}) as typeof readFileSync);
 const set=vi.spyOn(MLP.prototype,'setWeights');driverFor(f.spec,0,{seed:1,policies:[f.spec]});
 expect(createHash('sha256').update(Buffer.from(set.mock.calls[0][0].buffer)).digest('hex')).toBe(f.spec.weightsSHA256);expect(reads).toBe(1);
 expect(()=>driverFor(f.spec,1,{seed:1,policies:[f.spec]})).toThrow(/weights changed/);expect(reads).toBe(2);
 read.mockImplementation(actual.readFileSync);
});
it('hot hits still read and verify while each driver owns decider, tracker and RNG',()=>{
 const f=fixture(544),read=vi.mocked(readFileSync),set=vi.spyOn(MLP.prototype,'setWeights'),decide=vi.spyOn(NeuralDecider.prototype,'decide');read.mockClear();
 const options={seed:91,policies:[f.spec]},a=driverFor(f.spec,0,options),b=driverFor(f.spec,0,options),c=driverFor(f.spec,1,options);
 expect(read.mock.calls.filter(row=>row[0]===f.path)).toHaveLength(3);expect(set).toHaveBeenCalledTimes(1);
 const state=startGame(createMatch({...DEFAULT_RULES},91));state.turn=0;state.hands=state.hands.map(h=>h.slice(0,2));a.newGame(state,[]);b.newGame(state,[]);c.newGame(state,[]);
 const x=a.decide(state),y=b.decide(structuredClone(state));expect(y).toEqual(x);
 const contexts=decide.mock.contexts as NeuralDecider[];expect(contexts[0]).not.toBe(contexts[1]);expect(contexts[0].tracker).not.toBe(contexts[1].tracker);expect((contexts[0] as any).rand).not.toBe((contexts[1] as any).rand);
});
it('cold shape and finite checks use the hashed raw bytes before cache insertion',()=>{
 for(const [name,bytes] of [['shape',Buffer.alloc(3)],['finite',(()=>{const b=Buffer.from(new MLP(545,399).getWeights().buffer);b.writeFloatLE(NaN,0);return b;})()]] as const){
  const directory=mkdtempSync(join(realpathSync(tmpdir()),'v542-network-invalid-')),path=join(directory,name+'.f32');writeFileSync(path,bytes);const spec:PolicySpec={policyId:'invalid-'+name,kind:'neural',weightsPath:path,weightsSHA256:createHash('sha256').update(bytes).digest('hex'),inputDim:399,encoder,epsilon:0};expect(()=>driverFor(spec,0,{seed:1,policies:[spec]})).toThrow();
 }
});
