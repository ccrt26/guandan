#!/usr/bin/env python3
"""Single current R6 percentile/type7 kernel for teacher and formal blocks.
The historical frozen H implementation remains immutable and is regression
checked on synthetic data. No training, historical data or model is loaded.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import torch

VERSION='r6-paired-percentile-type7-20k-v1'
REPLICATES=20000

def linear_quantiles(values, probabilities):
    if not probabilities or any(type(q) not in (int,float) or not math.isfinite(q) or q<0 or q>1 for q in probabilities):raise ValueError('finite quantile probabilities required')
    return torch.quantile(values,torch.tensor(probabilities,dtype=torch.float64),interpolation='linear').tolist()

def cluster_bootstrap(unit_ids, columns, counts, seed, probabilities):
    n=len(unit_ids)
    if n<2 or any(not isinstance(i,str) or not i for i in unit_ids) or len(set(unit_ids))!=n:raise ValueError('at least two unique independent unit IDs required')
    if not columns or len(counts)!=n or any(type(v) is not int or v<1 for v in counts):raise ValueError('positive cluster counts required')
    if type(seed) is not int or seed<0 or seed>2**63-1:raise ValueError('fixed safe bootstrap seed required')
    names=sorted(columns)
    if any(not isinstance(k,str) or len(columns[k])!=n or any(type(v) not in(int,float) or not math.isfinite(v) for v in columns[k])for k in names):raise ValueError('complete finite paired columns required')
    order=sorted(range(n),key=lambda i:unit_ids[i]);ordered_ids=[unit_ids[i]for i in order]
    sums=torch.tensor([[columns[k][i]for k in names]for i in order],dtype=torch.float64);weights=torch.tensor([counts[i]for i in order],dtype=torch.float64)
    generator=torch.Generator().manual_seed(seed);draws=[]
    # Chunked indices preserve the same CPU Generator stream as the frozen H
    # primitive, while avoiding a20,000*N*K full allocation for formal N.
    for first in range(0,REPLICATES,64):
        indices=torch.randint(n,(min(64,REPLICATES-first),n),generator=generator)
        draws.append(sums[indices].sum(1)/weights[indices].sum(1)[:,None])
    draws=torch.cat(draws,dim=0);result={}
    for j,name in enumerate(names):result[name]={'point':float(sums[:,j].sum()/weights.sum()),'quantiles':linear_quantiles(draws[:,j],probabilities)}
    return{'implementation':VERSION,'method':'percentile','interpolation':'R_type_7_linear','replicates':REPLICATES,'seed':seed,'independentUnits':n,'unitIdsSHA256':hashlib.sha256(json.dumps(ordered_ids,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'sharedResamplingIndicesAcrossColumns':True,'probabilities':probabilities,'columns':result}

def paired_bootstrap(unit_ids,columns,seed,probabilities):
    return cluster_bootstrap(unit_ids,columns,[1]*len(unit_ids),seed,probabilities)

def teacher_evidence(primary,secondary,primary_seed,secondary_seed,primary_worlds=256):
    if primary_worlds not in(128,256,512):raise ValueError('verification count must be prelocked128/256/512')
    if set(r['worldId']for r in primary)&set(r['worldId']for r in secondary):raise ValueError('primary and secondary independent world IDs overlap')
    def interval(rows,seed,expected):
        if len(rows)!=expected:return None,'missing_independent_worlds'
        if any(r.get('A',{}).get('complete')is not True or r.get('B',{}).get('complete')is not True for r in rows):return None,'incomplete_branch'
        for r in rows:
            if any(type(r[arm].get('y')) is not int or r[arm]['y']< -4 or r[arm]['y']>4 or type(r[arm].get('g'))is not int or r[arm]['g'] not in(-3,-2,-1,1,2,3) or type(r[arm].get('W'))is not int or r[arm]['W'] not in(-1,1) or r[arm]['y']!=r[arm]['g']+r[arm]['W'] for arm in('A','B')):raise ValueError('complete g+W integer target required')
        return paired_bootstrap([r['worldId']for r in rows],{'d':[(r['A']['y']-r['B']['y'])/8 for r in rows]},seed,[.0125,.9875]),None
    a,reason_a=interval(primary,primary_seed,primary_worlds);b,reason_b=interval(secondary,secondary_seed,128)
    supported=a is not None and b is not None and a['columns']['d']['quantiles'][0]>.02 and b['columns']['d']['quantiles'][0]>0
    return{'implementation':VERSION,'resultCode':'supported'if supported else'incomplete'if reason_a or reason_b else'ambiguous','supported':supported,'primary':a,'secondary':b,'reasons':[v for v in[reason_a,reason_b]if v],'thresholds':{'primaryLowerStrictlyAbove':.02,'secondaryLowerStrictlyAbove':0},'scope':'root_action_only','negativeLabelProduced':False}

def pilot_root_evidence(primary,secondary,primary_seed,secondary_seed,primary_worlds=256):
    # Each root has four required comparisons, not just a favorable root pair.
    for rows,arms in((primary,('A','B','Plan','Original')),(secondary,('A','B'))):
        if any(r.get(arm,{}).get('complete')is not True for r in rows for arm in arms):return{'implementation':VERSION,'resultCode':'incomplete','supported':False,'reasons':['incomplete_required_branch'],'negativeLabelProduced':False}
        for r in rows:
            for arm in arms:
                x=r[arm]
                if type(x.get('g'))is not int or x['g'] not in(-3,-2,-1,1,2,3) or type(x.get('W'))is not int or x['W'] not in(-1,1) or type(x.get('y'))is not int or x['y']!=x['g']+x['W']:raise ValueError('complete typed original g+W target required')
    evidence=teacher_evidence(primary,secondary,primary_seed,secondary_seed,primary_worlds)
    if evidence['resultCode']=='incomplete':return evidence
    columns={'root_action':[(r['A']['y']-r['B']['y'])/8 for r in primary],'same_first_action_plan_continuation':[(r['Plan']['y']-r['A']['y'])/8 for r in primary],'full_plan_vs_original':[(r['Plan']['y']-r['Original']['y'])/8 for r in primary]}
    shared=paired_bootstrap([r['worldId']for r in primary],columns,primary_seed,[.0125,.9875])
    evidence.update({'primaryComparisonsWithSharedIndices':shared,'planContinuationSupported':shared['columns']['same_first_action_plan_continuation']['quantiles'][0]>.02,'fullPlanSupported':shared['columns']['full_plan_vs_original']['quantiles'][0]>.02,'learnedPlanClaim':False,'trainingConsumes':'root_action_pair_only_if_primary_and_secondary_support','planOnlyTailIntakeEligible':not evidence['supported']and shared['columns']['same_first_action_plan_continuation']['quantiles'][0]>.02 and shared['columns']['full_plan_vs_original']['quantiles'][0]>.02})
    return evidence

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['paired','teacher','pilot-root']);parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);args=parser.parse_args();torch.set_num_threads(2)
    raw=Path(args.input).read_bytes();data=json.loads(raw)
    if args.mode=='paired':result=paired_bootstrap(data['unitIds'],data['columns'],data['seed'],data['probabilities'])
    elif args.mode=='teacher':result=teacher_evidence(data['primary'],data['secondary'],data['primarySeed'],data['secondarySeed'],data['expectedPrimaryWorlds'])
    else:result=pilot_root_evidence(data['primary'],data['secondary'],data['primarySeed'],data['secondarySeed'],data['expectedPrimaryWorlds'])
    result.update({'inputSHA256':hashlib.sha256(raw).hexdigest(),'sourceSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'torchVersion':torch.__version__,'device':'cpu','torchThreads':torch.get_num_threads()})
    with open(args.output,'x',encoding='utf8')as stream:json.dump(result,stream,ensure_ascii=False,indent=2,allow_nan=False);stream.write('\n')
    print(json.dumps({'resultCode':result.get('resultCode','completed'),'output':args.output},allow_nan=False))
if __name__=='__main__':main()
