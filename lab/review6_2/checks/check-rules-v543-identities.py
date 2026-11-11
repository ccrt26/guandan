"""Pure candidate-contract check. No Learner/Net, forward, optimizer or worker."""
import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from distill_learner import candidate_contract, FIRST_TARGET_CANDIDATE_POLICY, RULES_V543_CANDIDATE_POLICY

policies = (FIRST_TARGET_CANDIDATE_POLICY, RULES_V543_CANDIDATE_POLICY)
for policy in policies:
    value = {'candidateSpecRef': policy['candidateSpec'], 'candidatePolicy': copy.deepcopy(policy)}
    before = copy.deepcopy(value)
    assert candidate_contract(value) is True
    assert value == before
    other = policies[1] if policy is policies[0] else policies[0]
    try:
        candidate_contract({**value, 'candidatePolicy': copy.deepcopy(other)})
    except (ValueError, RuntimeError, AssertionError):
        pass
    else:
        raise AssertionError('cross-revision candidate policy was accepted')
print('PASS: old/new exact candidate identities and cross-revision rejection; no model execution')
