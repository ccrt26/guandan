import {describe, expect, it} from 'vitest';
import {DEFAULT_RULES} from '@gd/engine';
import {digest, referenceOf} from '../review6_2/task-schema.mjs';
import {prepareDesignedSourceRequest, freezeDesignedSourceRequest} from '../review6_2/designed-source-request';

const spec = {questionId:'fixture-designed-one',designFamilyId:'fixture-designed-family',engineSourceRef:referenceOf('fixture-source',{baseCommit:'a'.repeat(40),files:[]}),rulesRef:referenceOf('fixture-rules',DEFAULT_RULES),ruleOptions:structuredClone(DEFAULT_RULES),coverage:{targetKind:'single',opponentSizeRelation:'>' as const,hasOrdinaryTakeover:true,partnerZero:false,hasNaturalNonJokerOption:true,ownHasFewerCardsThanPartner:false}};
const firstGameOrigin = {leaderSeed:1,firstLeader:2,previousPublicPrefixFailure:{gameNo:1,moveNo:0,expectedActorSeat:1,declaredActorSeat:0}};
const next = () => prepareDesignedSourceRequest({...spec,firstGameOrigin,comboDeclarationContract:'engine-combo-fields-v1'} as any) as any;

describe('explicit complete engine combo declaration contract', () => {
  it('preserves both consumed legacy request forms', () => {
    expect(digest(prepareDesignedSourceRequest(spec))).toBe('ff9c3f3e9d2a0c0ac9f19cd4b2a0bb4dd22fd0e2cfe5547f43ccd5240e112fab');
    expect(digest(prepareDesignedSourceRequest({...spec,firstGameOrigin} as any))).toBe('49f4554059be74b5e51332a62564f7ed89eaca394722757841b148e7da9426be');
  });

  it('supplies all ten kinds and original-engine single, level and joker examples', () => {
    const request=next(),guide=request.comboDeclarationGuide;
    expect(Object.keys(guide.byKind)).toEqual(['single','pair','trio','trio_pair','straight','pair_seq','trio_seq','bomb','flush','joker_bomb']);
    expect(guide.byKind.single).toEqual([1,1,'r','R(r)',[]]);
    expect(guide.byKind.trio_pair).toEqual([5,1,'trio rank r','R(r)',['pair rank s, s != r']]);
    expect(guide.byKind.straight).toEqual([5,5,'last raw rank','h',[]]);
    expect(guide.byKind.pair_seq).toEqual(['2L','L','last raw rank','h',[]]);
    expect(guide.byKind.trio_seq).toEqual(['3L','L','last raw rank','h',[]]);
    expect(guide.byKind.bomb).toEqual(['4..8',1,'r','R(r)',[]]);
    expect(guide.byKind.joker_bomb).toEqual([4,1,17,99,[]]);
    expect(guide.engineExamples.map((x:any)=>[x.kind,x.mainRank,x.keyRank,x.length])).toEqual([['single',3,3,1],['single',2,22,1],['joker_bomb',17,99,1]]);
    expect(guide.knownDeclarationPitfall).toEqual({kind:'single',keyRank:3,declared:{mainRank:0,length:0},engine:{mainRank:3,length:1}});
    const combo=request.responseSchema.properties.moves.items.properties.move.oneOf[1].properties.combo;
    expect(combo.properties.length.minimum).toBe(1);
    expect(combo.properties.mainRank.enum).not.toContain(0);
    expect(combo.allOf).toHaveLength(10);
    expect(combo.allOf.find((x:any)=>x.if.properties.kind.const==='joker_bomb').then.properties.keyRank).toEqual({const:99});
    expect(freezeDesignedSourceRequest(request)).toEqual(request);
    expect(digest(request)).toMatch(/^[a-f0-9]{64}$/);
    expect(freezeDesignedSourceRequest(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });

  it('rejects unknown modes, missing fixed origin and modified guide before transport', () => {
    expect(()=>prepareDesignedSourceRequest({...spec,firstGameOrigin,comboDeclarationContract:'arbitrary'} as any)).toThrow('designer_combo_contract');
    expect(()=>prepareDesignedSourceRequest({...spec,comboDeclarationContract:'engine-combo-fields-v1'} as any)).toThrow('designer_combo_contract_origin_required');
    const changed=structuredClone(next());changed.comboDeclarationGuide.byKind.single[1]=0;
    expect(()=>freezeDesignedSourceRequest(changed)).toThrow('invalid_designer_request');
  });
});
