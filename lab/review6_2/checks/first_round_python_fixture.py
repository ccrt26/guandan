"""Fixed synthetic objects only; never research evidence or real weights."""
import copy
import hashlib

def fixture_rows(contract, candidate_policy, sample_schema, parent_ref):
    rows=[]
    for split in ('train','dev'):
        for family in (split+'-a',split+'-b'):
            for direction in ('pass','takeover'):
                for kind in ('demo','keep'):
                    decision=family+'-'+direction+'-'+kind
                    x=[[0.]*423 for _ in range(12)]
                    x[11][399]=1.
                    common={'schema':sample_schema,'sampleKind':kind,'sampleClass':'target' if kind=='demo' else 'ordinary',
                        'decisionId':decision,'sourceFamily':family,'sourceRef':'source-'+family,'split':split,
                        'key':{'matchId':decision,'gameNo':1,'moveNo':0,'actorSeat':0},
                        'observationRef':{'id':decision,'sha256':'a'*64},'contextSHA256':hashlib.sha256(decision.encode()).hexdigest(),
                        'encoderVersion':contract['encoderVersion'],'candidateSpecRef':candidate_policy['candidateSpec'],
                        'candidatePolicy':copy.deepcopy(candidate_policy),'candidateIds':['a'+str(i) for i in range(12)],
                        'candidateOriginalIndices':list(range(12)),
                        'candidateCanonicalIds':['pass']+['play'+str(i) for i in range(1,12)],
                        'candidateFeatures':x,'rawQ':[0.]*12,'proposalRawQ':[0.]*12,'baseActionId':'a0',
                        'basePolicyRef':{'id':'B','sha256':'b'*64},'studentParentRef':parent_ref,
                        'qualityFlags':[],'provenance':{'inputSHA256':'c'*64,'recordSHA256':'d'*64,'matchSHA256':'e'*64,'samplingRef':'fixture'}}
                    if kind=='demo':common.update(targetIds=['a0' if direction=='pass' else 'a11'],teacherPolicyRef={'id':'teacher','sha256':'f'*64},
                        labelKind='teacher_action',executionKind='offline_suggested',labelSourceRef={'id':'label-'+decision,'sha256':'1'*64},
                        evidenceGrade='provisional_screened',direction=direction,validationRef={'id':'check-'+decision,'sha256':'2'*64})
                    rows.append(common)
    return rows

def fixture_identities(contract, candidate_policy):
    return {'basePolicy':{'policyId':'B','inputDim':399,'encoderVersion':'gd-lab-schema-v4','weightsSHA256':'3'*64},
        'teacher':{'releaseRef':'teacher','promptRef':'prompt','profileSnapshot':{}},
        'encoderVersion':contract['encoderVersion'],'encoderConfig':copy.deepcopy(contract),
        'proposalEncoderConfig':{'schema':'v2','ctxFill':'rule-context','passEncoding':'action64'},
        'candidateSpecRef':candidate_policy['candidateSpec'],'candidatePolicy':copy.deepcopy(candidate_policy),'promptRef':'prompt',
        'studentParentRef':'fixture-parent@sha256:'+'4'*64,'studentScorer':{'schema':'ohuo-student-scorer-v1','policyId':'fixture-S0',
        'modelVersion':'synthetic','architectureId':'mlp-tanh-256x256-scalar-v1','weightsLayoutVersion':'f32le-layer-w-row-major-then-b-v1',
        'parameterCount':174593,'inputDim':423,'weightsPathOrUrl':{'nodePath':'fixture.f32'},'weightsSHA256':'5'*64,
        'encoder':copy.deepcopy(contract),'tieBreakId':'first-candidate-v1'},'migrationReceiptRef':{'id':'fixture-migration','sha256':'6'*64}}
