# ohuo B00: bounded engineering delivery

Implements v5.2 §19 M9/checkPlan and §20 closeout. This is not a research runner,
a trash mover, an AI launcher, an authorization service, or a system sandbox.
Node standard library only. No package install, web server, API, model load,
training, repository-wide test, directory scan, permanent deletion, or push.

## Commands

Run from the checkout (the CLI derives its root from its own installed path):

```text
node scripts/ohuo-delivery.mjs inspect --batch deliverables/ohuo-batches/<batchId>/engineering-batch.json
node scripts/ohuo-delivery.mjs run-checks --batch <manifest> --site cloud --check B00.closeout-lifecycle --check B00.check-scope
node scripts/ohuo-delivery.mjs run-checks --batch <manifest> --site local --check B00.trash-local
node scripts/ohuo-delivery.mjs finish --batch <manifest>
node scripts/ohuo-delivery.mjs closeout-status --batch <manifest>
node scripts/ohuo-delivery.mjs record-closeout --batch <manifest>
node scripts/ohuo-delivery.mjs resume-closeout --batch <manifest>
```

Exit codes: 0 passed (inspect/status may still report cleanup pending), 1 failed
check, 2 rejected request/identity, 3 pending prerequisites. Read the JSON fields,
not only process exit status. `finish` does not run checks. `inspect` does not apply
patches: Sol still verifies the fixed parent and uses targeted `git apply --check`.
No selector, unknown/planned ID, wildcard, `--all`, `--cmd`, path/argv injection,
undeclared check fields, or wrong case/site is rejected before any child starts.
Malformed requests with an identifiable valid manifest receive a persistent
rejected receipt; a missing/unreadable/unregistered manifest cannot safely receive
writes and gets a rejected JSON response only.

First installation may bootstrap directly with precisely:

```text
node lab/review6_2/checks/check-delivery.mjs --case closeout-lifecycle --case check-scope
```

Those selectors create only self-owned disposable fixtures under
`lab/out/b00-checks/`, including an empty Git fixture and simulated trash. Fixture
cleanup deletes only directories created by that invocation, never project/user
cleanup candidates. The check script imports the production code with explicitly
injected finite probe registries/native-channel adapters; those adapters are not
CLI options or manifest capabilities. The public CLI uses the fixed registry.

## Manifest and identities (schemaVersion 1)

Keep the sole `engineering-batch.json` at
`deliverables/ohuo-batches/<batchId>/engineering-batch.json`. `<batchId>` is a safe
ASCII identifier. Required top-level fields are all §19 engineering fields:
`batchId`, `revision`, `status`, `baseCommit`, `acceptedParentRef`, `dependsOn`,
`authorizationRef`, `authorizedScope`, `authorTaskRef`, `ownerFiles`, `allowedPaths`,
`protectedPaths`, `changeSummary`, `artifactRef`, `patchSHA256`, `changedFiles`,
`checkPlan`, `cloudEvidence`, `localEvidence`, `manualEvidenceRefs`,
`checkReceiptRefs`, `acceptedCodeRef`, `compatibilityDeltaRef`, `unresolved`,
`recoveryRef`, `cleanupCandidates`, `closeoutTaskRef`, `closeoutReceiptRef`.
Missing result fields start null/empty, never fabricated passed. Optional
`cleanupChannel`, `closeoutEvidence`, and the §19 restricted-continuation fields
are supported. Unknown top-level/check-item fields are rejected.

A readable reference is `{ "path": "repo/relative/file", "sha256": "64 hex" }`.
Every path must be explicit and within `allowedPaths`, without traversal or
symlink components. `protectedPaths` forbids writes/cleanup/current executable
source. A frozen check input may explicitly use `{path,sha256,readOnly:true}`
inside the protected set only when its fixed check requires `private_asset_read`
and the original `realAssetChecks` scope grants it. Missing authorization stays
pending with no child execution. Actual model paths and hashes must be listed;
do not substitute a model index and hide the real input. This limited read-only
exception does not permit a protected change, executable or cleanup candidate. References name regular files, not
implicit directories. `sourceRef` is `{ "baseCommit": "40 hex", "files": [refs] }`:
all affected current files plus actual check entry/helper dependencies. It is not
merely HEAD. `changedFiles` rows are `{path,beforeSHA256,afterSHA256}` (null denotes
absent); `ownerFiles` enumerates their exact names. `allowedPaths` is a short list
of file/subdirectory prefixes, including necessary evidence and this batch's
result directory. Do not list `.` or the project root. For a non-base parent, acceptedParentRef is `{receiptRef,sourceRef}` and the
referenced immutable `accepted-code.json` (`kind: functional-acceptance`) must
bind that exact source. Do not reference mutable `delivery-state.json` as a parent. Each before digest
is compared with that parent or its fixed base Git blob. The parent commit must
exist in current HEAD ancestry; affected bytes must match pre-apply or post-apply
for inspect, and post-apply sourceRef for checks/finish. `dependsOn` references
immutable `accepted-code.json` JSON from accepted parent batches. Their directories
must be explicitly readable. A patch reference must match `patchSHA256`.

Authorization is *evidence*, not an AI-created permission. `authorizationRef`
points to the actual original user instruction materialized in the executor;
`authorizedScope` entries point to its relevant `basisRef`:

```json
{
  "develop": {"basisRef": {"path": "...", "sha256": "..."}},
  "apply": {"basisRef": {"path": "...", "sha256": "..."}},
  "syntheticChecks": {"basisRef": {"path": "...", "sha256": "..."}, "capabilities": ["offline_synthetic"]},
  "realAssetChecks": {"basisRef": {"path": "...", "sha256": "..."}, "capabilities": ["private_asset_read", "real_model_forward"]},
  "cleanup": {"basisRef": {"path": "...", "sha256": "..."}, "categories": ["temporary-download"], "destination": "trash"}
}
```

Omit scopes not actually granted. The executor must verify the quoted instruction
really grants each action/object/limit: checking file identity does not interpret
or grant human authority. Separate API, research, service, model and optimizer
permissions are never inferred from a check name. The B00 public registry only
requires offline synthetic checks. No claimed approval boolean is accepted as
substitute for readable original evidence.

## Frozen checkPlan

`checkPlan` contains `planRef`, `revision` (same as batch), `sourceRef`, `checks`
(required acceptance set, not this invocation's subset), and explanatory `notRun`.
A check has the §19 exact fields `checkId`, `site`, `entryId`, `caseId`, `inputRefs`
(nonempty), `expected`, `requires`, `authorizationRefs`, `directImpactReason`,
`reuseEvidenceRef` (null or fixed receipt). Optional `manualEvidenceKey` and
`dependsOn` (check IDs) are supported. Dependencies must explicitly precede the
case in the current request; after failure only its dependents are skipped.

B00 implemented mappings:

| checkId | entryId | caseId | mode/site |
|---|---|---|---|
| B00.closeout-lifecycle | delivery_cases | closeout-lifecycle | node, cloud/local |
| B00.check-scope | delivery_cases | check-scope | node, cloud/local |
| B00.trash-local | delivery_manual | trash-local | manual, local |

All require exactly `offline_synthetic`. The executable cases map to
`lab/review6_2/checks/check-delivery.mjs --case <caseId>`; the fixed registry declares
its source/helper files. B01–B10 entries are **planned**, not callable. A later
batch adds its reviewed implementation to the one registry with fixed runtime,
path, imports/selector, sites, requirements and direct sourcePaths. A manifest
cannot add code, flags, entrypoints or arbitrary arguments. There is no fallback.

Each receipt preserves requested/executed/reused/manual/not-executed lists,
exact executable/argv/cwd/shell:false, runtime version, input/source identities,
start/end, expected/actual, exitCode and bound output log. Receipts are saved
before child startup and after each result; SIGINT/SIGTERM stops the active
child and preserves completed facts. A forced kill may leave a writer lock and
a pending receipt; do not call that passed. Inspect the recorded PID/process
ownership before removing only that stale batch lock and retrying explicit IDs.

The first attempt seals the checkPlan digest in `check-plan-revisions.json`;
changing the frozen plan without a revision increment is rejected.
A new unaccepted revision may reuse a successful old same-batch/plan receipt only
when case source/helper bytes, inputs, requirements, case and expected result
match. It records `reused`, the original source/site, and no local command.
A cloud receipt may be consumed on a Mac with a different Node installation path;
its fixed argv, runtime kind/version and actual output still must match. This
proves neither Mac environment compatibility nor actual local assets. `finish`
checks the entire required set and actual fixed commands/logs, never a passed
flag or just the latest process exit code.

### Actual local manual evidence

The manifest result map `manualEvidenceRefs[manualEvidenceKey]` points to JSON
containing batchId/planRef/revision/sourceRef/checkId/caseId/inputRefs,
`toolReceiptRefs`, `observations:[{key,expected,actual}]`, and `incomplete:[]`.
B00 requires true observations for `sourceAbsent`, `trashIdentityMatches`,
`repeatReceiptIsIdempotent`, `protectedCandidateRejected`. Actual tool receipts
must substantiate the last two; a passed boolean alone never qualifies.

For B00.trash-local, copy only the provided `delivery-fixtures/trash-sample.txt`
into an explicit disposable `lab/out/<local-task>/` path covered by the batch.
Use the authorized existing Mac system Trash operation, preserving its actual
source→destination result; do not use rm or empty Trash. Include:

```json
{"filesystem":{"sourcePath":"lab/out/<local-task>/trash-sample.txt","destinationPath":"/Users/<user>/.Trash/<actual-name>","sha256":"<sample digest>","channel":{"kind":"trash","root":"/Users/<user>/.Trash"}}}
```

The manual adapter also checks the source is absent, destination bytes match the
frozen sample input and destination is the current Mac user's actual `.Trash`.
On Linux, no native Trash proof is claimed: it stays pending. Other OS and volume
Trash implementations need a separately reviewed adapter. Sol records a genuine
repeat/no-extra-move result and protected-candidate rejection using the delivered
entry, not an invented UI assertion. A minimal same-batch closeout fixture can be
used; preserve its explicit manifest/receipt instead of operating on real models
or old directories. Non-machine UI observations remain human/tool evidence, not
facts a schema can independently prove.

## Closeout: no deletion performed by this program

`finish` first accepts only the complete valid functional evidence. It atomically
writes a unique `closeout-task.json`, immutable `accepted-code.json`, and mutable
`delivery-state.json`; repeated finish or
resume returns the same task identity. Immutable accepted intent includes the
plan and candidates; edits require a new batchId. Result evidence can be appended.
No candidates produces a persistent noop receipt and closes without any scan.
An interrupted noop write is resumed only after checking the prior receipt
binds the same task and empty candidate set. The returned `acceptanceRef` stays
byte-identical when later cleanup changes `delivery-state.json`, so unrelated
dependent functions are not blocked by parent cleanup.
Otherwise the function remains accepted while delivery stays open/cleanup_pending.

Each candidate has `candidateId`, `path`, `category`, `sha256`, `recoveryRef`,
`activeDependencies`, `dependencyCheckRef`, `allowedDestination:"trash"`.
Supported categories: `temporary-download`, `temporary-unpack`,
`rebuildable-check-output`, `superseded-copy`. B00 only validates individual
regular files. Directories, unknown categories, active/current source, protected
paths, changed bytes and absent unreceipted sources stay blocked; it never
recursively guesses contents. Future directory support is not implied.

`dependencyCheckRef` JSON binds batchId/sourceRef/candidatePath/candidateSHA256,
checkedAt/validUntil, checkedBy, activeDependencies:[], evidenceRefs, and
checkedScopes containing `current-run`, `model`, `save`, `source`, `recovery`.
The empty list alone is insufficient; the executor must really check those
specific dependencies and retain evidence. Expired/unknown checks block the item.
Both batch and candidate recovery references must be readable fixed content.
The recovery JSON has `baseCommit`, nonempty `artifactRefs`, `restore` instructions,
`verifiedAt` and a `verificationRef` to the actual restoration check. All referenced
artifact bytes are checked. Identity/completeness does not itself prove a human
performed a remote restore; retain the real verification result.

`cleanupChannel:{kind:"trash",root:absoluteCurrentMacTrash,evidenceRef}` must be
actually available. Sol, not Node, executes authorized moves. Channel unavailable
means pending; there is no permanent-delete substitute. To unblock later without
rewriting accepted intent, append `closeoutEvidence` with `recoveryRef`,
`cleanupAuthorization`, `channel`, or `dependencyEvidenceRefs:{candidateId:ref}`.
These are fresh verified results, never modifications to candidate identities.

Sol writes `closeoutReceiptRef` in the result area pointing to
`{batchId,taskRef,entries:[...]}`. A done entry has
`{candidateId,status:"done",sourcePath,destinationPath,sha256,operationRef}`;
retained has `{candidateId,status:"retained",sourcePath,sha256,reason,releaseCondition}`.
Record verifies actual destination bytes, absent source, task identity and
operation reference; retained verifies the still-present unchanged source.
Submit only confirmed entries after partial interruption. Prior confirmed entries
persist; replay is idempotent, conflicts reject. Every candidate having done or
named retained concludes the delivery; retained yields `partial`, never "deleted".
Missing source without credible mapping is unknown, not done. Protected/outside
candidates remain blocked rather than permitting a false verified retention.

`accepted-code.json` is the stable parent/dependsOn credential. `delivery-state.json`
records the accepted source, immutable intent digest, task,
confirmed mappings and receipt refs. Keep it plus needed evidence/recovery links.
No-op/done/partial distinguish actual active-directory reduction from disk-space
release: moving to Trash generally does not immediately free disk. No byte-saving
claim is calculated by this entry.

## Scope and trust

This is a small normal-entry contract, not a security boundary against someone
with arbitrary terminal/code/file-edit rights. They can bypass the entry or forge
files; reviewers must inspect the actual frozen call chain and original authority.
The check code's only child commands are fixed Node selectors and finite Git
fixture operations. There is no hidden npm test or training call. Signing/auth
platforms, watchers and full-project dependency scans are deliberately absent.

For recovery, retain the immutable full patch, exact before/after digests, fixed
base/accepted-parent chain and local adaptation delta. Reverse only the batch's
patch after verifying no later changes to those files; never reset --hard or
replace the entire checkout. Mac-specific checks still pending must be reported
by name. Cloud readiness is not local acceptance or deployment.
