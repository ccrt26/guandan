import{it,expect}from'vitest';import{releaseVerdict,FORMAL_COUNTS,attemptBinding}from'../review6_2/confirmation';
const skills=()=>({kind:'skills60',passedFamilies:51,unknownFamilies:0,illegalDecisions:0,severeErrors:0,severityUnknownFamilies:0,categories:{cooperation_open:12,cooperation_urgent:13,resource_structure:13,context_sensitive_candidate:13},families:Array(60).fill({}),decisions:Array(75).fill({})});
const severe=()=>({kind:'severe24-v2',families:Array(24).fill({}),fullyAdjudicated:true,illegalDecisions:0,severeErrors:0});
const matches=()=>({phase:'sealed',counts:FORMAL_COUNTS,physicalCompleteMatches:34958,cooperation:{macro:{point:.04,quantiles:[.01,.07]},group0:{quantiles:[-.02,.08]},group1:{quantiles:[-.02,.08]},group2:{quantiles:[-.02,.08]}},M1:{point:.56,quantiles:[.51,.61]},M2:{point:.52,quantiles:[.46,.58]}});
it('requires every shared release gate and the complete fixed match count',()=>{
 expect(releaseVerdict(skills(),skills(),severe(),matches()).status).toBe('qualified_candidate');
 const m=matches();m.physicalCompleteMatches--;expect(releaseVerdict(skills(),skills(),severe(),m).status).toBe('incomplete');
 const low=matches();low.cooperation.macro.point=.029;expect(releaseVerdict(skills(),skills(),severe(),low).status).toBe('failed');
});
it('keeps baseline uncertainty and unresolved severity pending',()=>{
 const old=skills();old.unknownFamilies=1;expect(releaseVerdict(skills(),old,severe(),matches()).status).toBe('incomplete');
 const candidate=skills();candidate.passedFamilies=50;candidate.unknownFamilies=1;candidate.categories.cooperation_open=11;candidate.families[0]={category:'cooperation_open',unknown:true,possiblePass:true};expect(releaseVerdict(candidate,skills(),severe(),matches()).status).toBe('incomplete');
 const s=severe();s.fullyAdjudicated=false;expect(releaseVerdict(skills(),skills(),s,matches()).status).toBe('incomplete');
 const error=severe();error.fullyAdjudicated=false;error.severeErrors=1;expect(releaseVerdict(skills(),skills(),error,matches()).status).toBe('failed');
});
it('rejects a forged, changed or previously closed shared attempt binding',()=>{
 const a:any={number:1,status:'opened',candidateSHA256:'w',policySHA256:'p',examFiles:[{path:'exam',sha256:'e'}]},ledger={protocolId:'test',attempts:[a]};
 expect(()=>attemptBinding(a,ledger,'w','p','exam','e')).not.toThrow();
 expect(()=>attemptBinding(a,{attempts:[]},'w','p','exam','e')).toThrow(/ledger/);
 expect(()=>attemptBinding(a,ledger,'w','changed','exam','e')).toThrow(/binding/);
 expect(()=>attemptBinding({...a,status:'completed'},ledger,'w','p','exam','e')).toThrow(/opened/);
});
