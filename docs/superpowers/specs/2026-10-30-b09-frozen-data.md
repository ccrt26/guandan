# B09 / M6 frozen decision data v2 (B09-TIE-1)

## Scope and ownership

`distill-data.ts` is the only export/Node validation entry. It does not call a model, find labels in arbitrary replay, enumerate candidates, generate matches, train, or alter a default policy. B07 owns real record/capture; B10 owns learner/mask. The two cloud check selectors use finite synthetic decisions. `read-distill-data.py` only verifies the same transferred fixture; a cloud run is not the pending Mac check.

## Input

`freezeDataset({plan, sourceIndexPath, sourceQueue, rows, outputDir})`:

* Read the existing source-index JSON without writing it; verify exact file bytes SHA and its family split assignments.
* Verify `sourceQueue` canonical JS JSON SHA, its fixed B07 queue schema and source-index reference. Each `plan.games` row must match queue matchId/current game `roundFamilyIds[gameNo-1]`/split/actor; never apply the first family to later games. Bind the recorded game's source SHA as well.
* Each row points to the B07 public MatchRecord and its actual RecordedDecision, plus the hash-bound `ohuo-decision-input-v1` private record. `sampleKind` and pre-query `sampleClass=target|ordinary` are supplied by the fixed sampling plan, not inferred from teacher success or game outcome. Sampling authorization/target definition remain the caller's fixed plan, not newly granted by this helper.
* Match source/queue identity, actor, full B seat policy identity, private key/hash, input encoder config/identity, initial-C IDs and rawQ/action mapping must agree. B07's `candidateInputs` captures each same canonical action's vector using the original state/tracker/explicit encoder; B09 does not rescore or reconstruct.
* `plan.identities` freezes full B identity, encoderVersion/encoderConfig, candidateSpecRef, promptRef and teacher `{releaseRef,promptRef,profileSnapshot}`. A committed demo must agree with the actual seat snapshot and each upstream request's profile/revision/hash/credential revision/protocol/requested model. The teacher is not represented as fictitious local weights. Stage4 requires the B weights SHA and pass encoding. Explicit engineering fixtures may preserve an incomplete synthetic B identity without inventing weight bytes; they are always diagnostic and cannot pass `requireTrainingEligible`.

`prepareOfflineLabel` is a **read-only explicit adapter**, not a connected collection pipeline. It verifies the original full causal observation from the supplied state/history, shared selector key/final choose, offered canonical candidate and strict legality without executing the move. It binds that actual result to the private input hash and teacher snapshot. B07 currently has no integrated collect→offline-final-choose producer. Its owner will implement the explicitly tracked B07-L increment using the existing task host, budget meter and selector; B09 does not claim that dependent chain is complete. Arbitrary handwritten JSON is not real collection evidence.

## One representation

A new `lab/out/<task>/...` directory contains only:

1. `samples.jsonl`: one JSON object per decision, preserving order and actual variable K (1…8).
2. `manifest.json`: schema `ohuo-distill-dataset-v2`, datasetId, frozen plan, explicit identityRefs, samples `{path,sha256,bytes,decisions}`, valid/excluded counts, per-family counts, exclusions with reason/record hash, §14 coverage qualification.

`FrozenDatasetRef={directory,manifestSHA256}` pins exact UTF-8 manifest bytes (including final newline). Sample-file SHA pins exact UTF-8 bytes. Relocation changes only `directory`; it never changes the frozen manifest. Python must not reproduce JS `JSON.stringify` hashes using `json.dumps`; compare exact file bytes and the stored explicit identityRefs.

Each `ohuo-distill-decision-v2` has decisionId, sourceFamily/sourceRef/split/key, observationRef, contextSHA256, encoderVersion/candidateSpecRef, candidateIds/candidateOriginalIndices/candidateCanonicalIds/candidateFeatures (K×399), finite rawQ (K), baseActionId, basePolicyRef, sampleClass, qualityFlags and provenance. **Both demo and keep, train and dev, retain same-order B rawQ and B first-choice ID.** This supports dev disagreement without inference/forward passes. `candidateOriginalIndices` is the original pool action enumeration index, looked up from the same action object in C order; it is not aNNN rank or C position. Indices are unique, nonnegative safe semantic integers of length K. An S score tie uses the smallest original index, preserving B's existing tie definition; no tie rule is changed. Both consumers require v2 and reject v1 rather than invent missing indices.

* Demo additionally has nonempty initial-C `targetIds`, teacherPolicyRef, labelKind=`teacher_action`, executionKind=`committed|offline_suggested`, labelSourceRef. Current API actions yield a singleton target; no unverified equivalent-action set is manufactured.
* Keep has none of these teacher/target fields; it needs only the frozen B inputs and ordinary sampling role.
* Fallback, cancelled, halted/unknown, pending/expand-only are not demos. Unknown targets and rawQ length mismatch have explicit reasons. A legal expansion-only target stays in source records and exclusion coverage, never becomes target=0 or B.
* Duplicate decision ID or same source-family causal observation/candidate context excludes **all** conflicting rows, independent of demo/keep order. No contradictory keep target is manufactured.

Exporter rejects bad rows with reasons before freezing. It does not hide source errors or rewrite records. §14 qualification uses final admitted data: 16 train/4 dev families, each target+ordinary demo, maximum 32 demo/family, train target disagreements≥32, dev≥8 across≥2 families, train Ndemo≥32 and both keep splits present. A fixture or deficient dataset remains diagnostic; coverage eligibility does not prove teacher quality, authorize training, or establish strength.

`loadFrozenDataset(ref,{expectedIdentities?,requireTrainingEligible?})` requires the original manifest hash, exact sample bytes, every row/branch/identity/count/qualification, and no duplicates. Missing/changed/bad files or rows fail the whole load. It never silently skips after freeze or changes Ndemo. Structural/shape/hash checks cannot prove semantic correctness of same-length swapped features; B07's action-bound construction and its finite ordinary/pass/wild capture evidence provide that separate boundary.

## Fixed checks and limits

Cloud direct-development commands:

```
node --import tsx lab/review6_2/checks/check-distill-data.ts --case align-and-admit
node --import tsx lab/review6_2/checks/check-distill-data.ts --case reject-and-freeze
```

Mac (after transferring the same immutable fixture and its expected readback):

```
python3 lab/review6_2/checks/read-distill-data.py --dataset <fixture/dataset> --manifest-sha256 <fixed SHA> --expected <fixture/expected-readback.json>
```

No default/all selector. B00 registry owner alone wires B09 IDs; these commands are not a fabricated M9 receipt. No full-suite rerun, P11 fitting, softmax/optimizer proofs, mask/gradient checks, historical scans, real weights, real API, matches or training.
