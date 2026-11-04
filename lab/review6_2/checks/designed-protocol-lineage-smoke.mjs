/** Self-contained actual old protocol/rule snapshot, plus explicitly synthetic
 * current-revision edits. No host, Task, private sample, source bytes or I/O.
 * Captured from the original public-projection reference files; old canonical
 * refs and original file SHA256s were verified before embedding these values.
 * Importing this file builds no fixtures and runs no checks. */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {digest,referenceOf} from '../task-schema.mjs';
import {verifyDesignedProtocolLineage} from '../designed-protocol-lineage.mjs';
import {PROJECT_RULE_OPTIONS,PROJECT_RULES_TEACHER_PROMPT_SCHEMA,PROJECT_RULES_TEACHER_PROMPT_ID,PROJECT_RULES_TEACHER_WIRE_SCHEMA,PROJECT_RULES_TEACHER_SYSTEM_SHA256} from '../../../packages/web/server/llm-project-rules-v541.mjs';
export const ACTUAL_LINEAGE_FIXTURE_SOURCES = {
  "protocol": {
    "ref": "v530-r2-common-view-protocol@sha256:5f47d5af553be9eb96af02ea96e32542dc9c4078a4a858e9e69fb368f2cf1c9f",
    "fileSHA256": "eb415d44d7e90891ee8acf53eb9401d4bb2bcfbb9dcce324750dd8984c23c861"
  },
  "policy": {
    "ref": "v530-r2-resource-policy@sha256:63b8c0442605607717e4d7ac4b2d7a25959d96e8e72310d731464576f0e53042",
    "fileSHA256": "2a91b233bd655aa85a38247869d3bd2eae4ebc2428162ef60ebdf1b909628948"
  },
  "referenceCount": 142,
  "uniqueObjectCount": 53,
  "referenceSourceManifestSHA256": "e18815d00851d0360f58e9bced8a234b25258fd70704261f5fcc7e9da0e9d653",
  "referenceValuesSHA256": "479f1c2811259213a5daeff4c99cf838b568b99997cef6b85fd262ef039404eb"
};
const OLD_PROTOCOL = {
 "schema": "ohuo-first-round-protocol-revision-v2",
 "protocolId": "first-round-common-view-r2",
 "planRef": "v530-approved-round-one-plan@sha256:0c27ae09bddc76791008ea5ee37bc0bf1818151654b6a951191774ad3cbe402c",
 "planVersion": 1,
 "budgetRef": "v530-shared-original-budget@sha256:ace401cb8a1267e6dbacbe24c1f74ac41b306ac19bbe9a825fa5860a2fff868f",
 "scientificDocument": {
  "id": "r2-current-plan-saved-readback",
  "sha256": "dad66069442f16fc8c65d16bdc55463af873cd6c88197d773158b5db36e92a51"
 },
 "authorizationEvidence": [
  {
   "id": "r2-user-authorization-original-readback",
   "sha256": "69dcecc29712b0793eaec662bc540a0ccc61e7b722c4a2a2410ac92dc6aa5220"
  }
 ],
 "originalMethods": {
  "sourceSpecRef": "v530-original-source-spec@sha256:570e9fa206d5e3ca446e47a59911e9c9ca82172b5ac0ddc9cdec98238fb17ed6",
  "sourceReservationRuleRef": "v530-source-reservation-rule@sha256:42eb89ca3b097ebfaa9abbce271e5562fbf23275a61ce8224ca3d2c3b99e4a6f",
  "primaryTeacherRef": "v530-glm-teacher@sha256:36cf8a9ef700f8ec02ca74ad2a96dc6c8427b8c850519430a245882d134f9e37",
  "independentTeacherRef": "v530-deepseek-teacher@sha256:06fd5c20f5a202c39be9573951cb02e043cd471623c378389009fe9a32876552",
  "commonViewPromptRef": "v530-r2-common-view-prompt@sha256:ddec40958ef7e145f1f64e1eee46e6810820a4c96809a788c3f22b6776e98443"
 },
 "actions": [
  {
   "clauseRef": "v530-source-reservation-clause@sha256:87cfd6f2efd55f5010c1c5f5538c70f7abf542e9c826366e4b31fff697be9ac8",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [],
   "expectedArtifactKinds": [
    "ohuo-first-round-source-production-v1"
   ],
   "acceptanceRuleRef": "v530-source-reservation-action-rule@sha256:ea34484daf8d0d7cffae40f2d39e7bff8c208dc7541d664162b0e1faa7c74589",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-budget-allocation-clause@sha256:396bceb5aedfe0867c89ce2bbce5f8555697d6561f27d7af856c1371438531b7",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [],
   "expectedArtifactKinds": [
    "ohuo-first-round-budget-allocation-v1"
   ],
   "acceptanceRuleRef": "v530-budget-allocation-rule@sha256:deb088594db2766d7b1dadf0bad610e3ba7b02afd613764594f55e0ab7386cde",
   "skipRuleRef": "v530-r2-no-artificial-allocation-rule@sha256:111e49d1571efe931f5ae848f304ee555d4719816e47a90f71b2f0ae1b72a5aa",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-pilot-source-clause@sha256:012487082c94017597c5c1033794c8ffa7fe84fe43ce1cb50c86fe50f7cada69",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-pilot-source-train"
   ],
   "dependencyRefs": [
    "v530-pilot-source-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-pilot-source-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-pilot-source-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-pilot-source-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956"
   ],
   "expectedArtifactKinds": [
    "ohuo-match-summary-v1"
   ],
   "acceptanceRuleRef": "v530-pilot-source-action-rule@sha256:db291545b56c31d1814ae8b64368194198d8197aa9c27f0da41f18be77977d59",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-pilot-selection-clause@sha256:d5a68644cb1c1469f88c329601112d3e57bf1c6d6790ba68e2c565d3c3511108",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-pilot-selection-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-pilot-selection-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-pilot-selection-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-pilot-selection-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-selection-production-v1",
    "ohuo-offline-label-selection-v2"
   ],
   "acceptanceRuleRef": "v530-pilot-selection-action-rule@sha256:6386ec415c164208232d51f1182f9b3aadcec852eaad532ee4fc8e51537d7b07",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-pilot-glm-clause@sha256:26125fa9d00f783929fc70be7eee0aff58eb9d3a82f52c4fbf7ad6567cb9b14a",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-pilot-glm-train"
   ],
   "dependencyRefs": [
    "v530-pilot-glm-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-pilot-glm-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-pilot-glm-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-pilot-glm-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-pilot-glm-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-pilot-glm-action-rule@sha256:dd4987a5a005e05bb49399aceeaed5c8e9b76e360b8ca77f26197c3460106a26",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-pilot-screen-clause@sha256:a7a21cb31dcc290fbc0dd929b6ec31b21fc249d6b111f6bf3eca8ed049dd9def",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-pilot-screen-train"
   ],
   "dependencyRefs": [
    "v530-pilot-screen-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-pilot-screen-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-pilot-screen-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-pilot-screen-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-pilot-screen-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-screen-summary-v1"
   ],
   "acceptanceRuleRef": "v530-pilot-screen-action-rule@sha256:2489caa75bbb940470571f96fcb4a90c6749d44e4e020b007ccb32dfcff3faf5",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-pilot-ds-clause@sha256:f0e48c747505ee670033e79c6a4a22563f1bd24e33a0723141275f09d6513fae",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-pilot-ds-train"
   ],
   "dependencyRefs": [
    "v530-pilot-ds-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-pilot-ds-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-pilot-ds-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-pilot-ds-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-pilot-ds-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-pilot-ds-action-rule@sha256:53a606c9f2c76fea2c0fcdbf817471e6cf263ed3ca5b65c390f96d903b602130",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-data-source-clause@sha256:40c4b6497a4b6f7e01f32421c6ed35694b70dc1634750cb7a55ad6eae6b0b6dd",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-data-source-train",
    "r1-data-source-dev"
   ],
   "dependencyRefs": [
    "v530-data-source-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-data-source-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-data-source-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-data-source-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956"
   ],
   "expectedArtifactKinds": [
    "ohuo-match-summary-v1"
   ],
   "acceptanceRuleRef": "v530-data-source-action-rule@sha256:3d98793e8b25ec17762bbe07fba6ba4e84ce2f365ded22edf9321bb4d2fe3e33",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-data-selection-clause@sha256:d5a68644cb1c1469f88c329601112d3e57bf1c6d6790ba68e2c565d3c3511108",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-data-source-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-data-selection-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-data-selection-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-data-selection-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-selection-production-v1",
    "ohuo-offline-label-selection-v2"
   ],
   "acceptanceRuleRef": "v530-data-selection-action-rule@sha256:6386ec415c164208232d51f1182f9b3aadcec852eaad532ee4fc8e51537d7b07",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-data-glm-clause@sha256:f79ffbd680c8b77dcb94704d194565634280148d564d1fbac7e447577820501d",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-data-glm-train",
    "r1-data-glm-dev"
   ],
   "dependencyRefs": [
    "v530-data-glm-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-data-glm-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-data-glm-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-data-glm-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-data-glm-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-data-glm-action-rule@sha256:9c2a3daef8fa8f82ae9d92128961c272eb2485135d218ed0b6d70c61652e8b8f",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-data-screen-clause@sha256:90c0eecbe02dcf05e38a690e8c9b2c05b6fe214f22183f0829ebd3ad1d81a41d",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-data-screen-train",
    "r1-data-screen-dev"
   ],
   "dependencyRefs": [
    "v530-data-screen-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-data-screen-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-data-screen-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-data-screen-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-data-screen-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-screen-summary-v1"
   ],
   "acceptanceRuleRef": "v530-data-screen-action-rule@sha256:d711980392ccec8425cb7210a1cc8993903920369bb93b642f0afcdea7464fc9",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-data-ds-clause@sha256:fd6ec56ad260e095ff3779ed61b67b462367ddbacfb018690160658c8bbccfe9",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-data-ds-train",
    "r1-data-ds-dev"
   ],
   "dependencyRefs": [
    "v530-data-ds-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-data-ds-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-data-ds-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-data-ds-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-data-ds-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-data-ds-action-rule@sha256:647b24346570ffdeb6b5a20a513c30048ed1c8ea8a3fbe70e374bd0d51f01c10",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-dataset-clause@sha256:a5f48a0d12f11bb7830abdb878b3fe9a4d94bb239a1c8e7ea19c988f87d34944",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-dataset-requires-teacher-transferability@sha256:08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54",
    "v530-dataset-requires-student-visibility-and-initial-c@sha256:e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c",
    "v530-dataset-requires-frozen-source-layout@sha256:69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6",
    "v530-dataset-requires-budget-scope@sha256:8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956",
    "v530-dataset-requires-selection-production@sha256:9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23"
   ],
   "expectedArtifactKinds": [
    "ohuo-distill-dataset-first-round-v4"
   ],
   "acceptanceRuleRef": "v530-dataset-action-rule@sha256:500f35cba08e7511204e54b104157036cf17b6eeebe736f8a5bcc603787269ba",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-training-calibration-clause@sha256:817f4dd610c93c154f864ee7df4600ecc0605e5ca2087acfc49da8702efcfc1f",
   "branchRef": "v530-numerical-recovery-branch@sha256:a7f10632d4d63178cf39e3c9ee642b29d50860a97e6d5fb51ad44dd1f02a2bca",
   "plannedTaskIds": [
    "r1-training-calibration"
   ],
   "dependencyRefs": [
    "v530-training-calibration-requires-teacher-transferability@sha256:3352dee0b2382ef0bcdc3ca3581557f28f50964925a5f9f48400d7c52becaa8c",
    "v530-training-calibration-requires-dataset-qualification@sha256:e5c3f6a4e5ec6bf7c3863ced06f641151b51c9886f05aab593157b4a28ae7d8c",
    "v530-training-calibration-requires-fixed-parent-recipe@sha256:8b3eda251acd395d0984b381dfd7bf6ab95123429f5e8105ee0d3d5897d6f782",
    "v530-training-calibration-requires-budget-scope@sha256:a48818f4d2b94c42955b267c6b2f3d71bc504156d112833719eb76b1a1ce16e4"
   ],
   "expectedArtifactKinds": [
    "ohuo-supervised-summary-v1"
   ],
   "acceptanceRuleRef": "v530-training-calibration-action-rule@sha256:e695f73d17ea49ac014cda3413bbb900ebecaf57c0dd7e04921953f67ae27998",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-training-formal-clause@sha256:01058bf9680a0535c92539c2c5a1da5a75eb8417d4d4dc0ccaa9db443a2d0d31",
   "branchRef": "v530-numerical-recovery-branch@sha256:a7f10632d4d63178cf39e3c9ee642b29d50860a97e6d5fb51ad44dd1f02a2bca",
   "plannedTaskIds": [
    "r1-training-formal"
   ],
   "dependencyRefs": [
    "v530-training-formal-requires-teacher-transferability@sha256:a04903917d3f53dd18ef14ebb7761989dc7de620447c97bdd89e4b00df0cfc51",
    "v530-training-formal-requires-dataset-qualification@sha256:b79eaadb8cd25ae4ba8471177a2f7a933328822690426e28c763e594c7126af3",
    "v530-training-formal-requires-fixed-parent-recipe@sha256:094c7c93184e3d9b65a88aaa289cc603ff10cc70f7261cc732626711c8dc3c5e",
    "v530-training-formal-requires-budget-scope@sha256:21da7186eb45c91af25a1a821e4ff97f9a591c47a56912d1fd65d427057bac57",
    "v530-training-formal-requires-calibration-qualification@sha256:8be1c644e480d9a2e4a4a5fe0bf8c34a0127ba8f0930b353b0d145cde1ebcfe8"
   ],
   "expectedArtifactKinds": [
    "ohuo-supervised-summary-v1"
   ],
   "acceptanceRuleRef": "v530-training-formal-action-rule@sha256:cfcda27121e95ce91bb07d57b6e8f68cbe2ce0fbeea4ab587d251b59aba9941a",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-student-finalization-clause@sha256:b2611ad4ad98b5a458e0f83a3e961fee0ed9b98b7b2827191fe8e53ebc73ae96",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-student-finalization-requires-complete-formal-training@sha256:2ad1f00b9a80a86c4f6b16e123c2190edf0dc28a69983b5492402e477fd5888b",
    "v530-student-finalization-requires-frozen-behavior-review@sha256:ae2f3af35f2286842370c8d9ce15ab59af94c5b6bca6109a1dcbebc14c439f5a",
    "v530-student-finalization-requires-allowed-checkpoints@sha256:a852e9ffee46f971a876b1496d2a5c7a939255b6ea616c2828586ae1409e5afe",
    "v530-student-finalization-requires-budget-scope@sha256:21da7186eb45c91af25a1a821e4ff97f9a591c47a56912d1fd65d427057bac57"
   ],
   "expectedArtifactKinds": [
    "ohuo-student-finalization-receipt-v1"
   ],
   "acceptanceRuleRef": "v530-student-finalization-action-rule@sha256:8c7eeabf15c25e0d2540b5704d236a30e4602f14d66c1b1cf21eba7e56dff8e8",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-new-test-source-clause@sha256:5322863ddfb452152adeedde253f76384dac182b1882cda81765aed8b0f6c22b",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-new-test-source"
   ],
   "dependencyRefs": [
    "v530-new-test-source-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-new-test-source-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-new-test-source-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-new-test-source-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-new-test-source-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-match-summary-v1"
   ],
   "acceptanceRuleRef": "v530-new-test-source-action-rule@sha256:085ffc6c7dbaf624cab3aecddf08470c8d63b7b8358e6aaf420275b379d1d85f",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-new-test-selection-clause@sha256:aa49835ba69f9960ebcdfcf47d67e7102984e29f1ef2e88e615d9ea1591bd770",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-new-test-selection-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-new-test-selection-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-new-test-selection-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-new-test-selection-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-new-test-selection-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-new-test-selection-result-v1",
    "ohuo-first-round-new-test-selection-commit-v1"
   ],
   "acceptanceRuleRef": "v530-new-test-selection-action-rule@sha256:ce1f3bf3f92cb652143cd9b03f0251111bed91971d924ab27fd1d79cc2095c95",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-new-test-glm-clause@sha256:61a840a3131b253c4659348fd239f68ea14924b2b352efa8286000cc340e7fbe",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-new-test-glm"
   ],
   "dependencyRefs": [
    "v530-new-test-glm-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-new-test-glm-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-new-test-glm-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-new-test-glm-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-new-test-glm-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7",
    "v530-new-test-glm-requires-selection-production@sha256:4386e4fcf567849c2346bdfa77a64542442029c06558396941c739730c23e044"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-new-test-glm-action-rule@sha256:324f11bb79b1b8e6e22c25a49fc25dbcf8cc516cb2068b08942aa3a0deaac043",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-new-test-screen-clause@sha256:bf55f78de6063310722a530a611ab18bb75581c5baf2487530f29753a22c8ffd",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-new-test-screen"
   ],
   "dependencyRefs": [
    "v530-new-test-screen-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-new-test-screen-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-new-test-screen-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-new-test-screen-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-new-test-screen-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7",
    "v530-new-test-screen-requires-selection-production@sha256:4386e4fcf567849c2346bdfa77a64542442029c06558396941c739730c23e044"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-new-test-summary-v1"
   ],
   "acceptanceRuleRef": "v530-new-test-screen-action-rule@sha256:73095c6aa4d4d341dc2a856822a9993e871d2dcf2915e3427426c1afeccb482c",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-new-test-ds-clause@sha256:0849bbe9ad430ec6cfdc6cd74c51198155d5fc1658dbb081f4b7802400b139b7",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-new-test-ds"
   ],
   "dependencyRefs": [
    "v530-new-test-ds-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-new-test-ds-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-new-test-ds-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-new-test-ds-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-new-test-ds-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7",
    "v530-new-test-ds-requires-selection-production@sha256:4386e4fcf567849c2346bdfa77a64542442029c06558396941c739730c23e044"
   ],
   "expectedArtifactKinds": [
    "ohuo-offline-label-summary-v1"
   ],
   "acceptanceRuleRef": "v530-new-test-ds-action-rule@sha256:71728c598d53a75e5ce7713c34c7294c8ed7391259f120e7f9c8fc5f6890322b",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-variance-pilot-source-clause@sha256:bf804f772ed18452dbe666e29b1068ea0ed4a0289794e039ea8ca333545177da",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-variance-pilot-source"
   ],
   "dependencyRefs": [
    "v530-variance-pilot-source-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-variance-pilot-source-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-variance-pilot-source-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-variance-pilot-source-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-variance-pilot-source-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-match-summary-v1"
   ],
   "acceptanceRuleRef": "v530-variance-pilot-source-action-rule@sha256:6467a1af64eacc2e155740a7f17639469f884e828e02f37be07fa6d4a11c7e94",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-confirmation-source-clause@sha256:8fb3161617e05dc6334d822ca31d9b8c1da971139d508fe66f361701c8e8d7fa",
   "branchRef": null,
   "plannedTaskIds": [
    "r1-confirmation-source"
   ],
   "dependencyRefs": [
    "v530-confirmation-source-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-confirmation-source-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-confirmation-source-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-confirmation-source-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-confirmation-source-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-match-summary-v1"
   ],
   "acceptanceRuleRef": "v530-confirmation-source-action-rule@sha256:55e28c1f3c3146b30ea7f385deea5f85d7e9a76eb4278f7ba72ae484846b5cc8",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-confirmation-planning-clause@sha256:bc0eef48f7f5b50b3d07e5a3a45e5d1c087e7c93604dae2b14c12cfe367256ba",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-confirmation-planning-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-confirmation-planning-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-confirmation-planning-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-confirmation-planning-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-confirmation-planning-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-source-confirmation-planning-v1"
   ],
   "acceptanceRuleRef": "v530-confirmation-planning-action-rule@sha256:9c02a3405b477d5aa8320d58100caea1b887786c03d0a52f33d6b1581367a024",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-round-readout-clause@sha256:90a103c130cd2113875c8056b18f433b2fca6c3c72bd3537b09a108a12f7ab19",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [
    "v530-round-readout-requires-student-selection@sha256:56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e",
    "v530-round-readout-requires-frozen-comparison-conditions@sha256:c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130",
    "v530-round-readout-requires-new-source-isolation@sha256:bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2",
    "v530-round-readout-requires-budget-scope@sha256:9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8",
    "v530-round-readout-requires-confirmation-isolation@sha256:190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7"
   ],
   "expectedArtifactKinds": [
    "ohuo-first-round-match-readout-v1"
   ],
   "acceptanceRuleRef": "v530-round-readout-action-rule@sha256:df2ec6ab10b8ab0756b1ea776197c794aaaec7e46f3921a8f78600efe3eac735",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  },
  {
   "clauseRef": "v530-round-closeout-clause@sha256:be77d3a3f0526f20162d632474f40afd30dd1656858e29c129d6c7441f83c0a7",
   "branchRef": null,
   "plannedTaskIds": [],
   "dependencyRefs": [],
   "expectedArtifactKinds": [
    "ohuo-plan-closeout-v1"
   ],
   "acceptanceRuleRef": "v530-round-closeout-action-rule@sha256:af73fc447d46d59deabcb8fc46ffdb6824538dee6cf52da84422fe1db540172e",
   "skipRuleRef": "v530-original-skip-policy@sha256:c8ccc67b24c02521640558ff9a522c6e23812fad4f6edbc2bf554d76f3185e91",
   "stopRuleRef": "v530-original-stop-policy@sha256:dee3b22309ea8b4a24776112611537a540c67cb6aebad0675b36ebb0f64abc20"
  }
 ]
};
const OLD_POLICY = {
 "schema": "ohuo-round-resource-policy-v1",
 "mode": "input-workload-only",
 "protocolRevisionRef": "v530-r2-common-view-protocol@sha256:5f47d5af553be9eb96af02ea96e32542dc9c4078a4a858e9e69fb368f2cf1c9f",
 "planRef": "v530-approved-round-one-plan@sha256:0c27ae09bddc76791008ea5ee37bc0bf1818151654b6a951191774ad3cbe402c",
 "budgetRef": "v530-shared-original-budget@sha256:ace401cb8a1267e6dbacbe24c1f74ac41b306ac19bbe9a825fa5860a2fff868f",
 "authorizationRef": "v530-user-continuation-authorization@sha256:04136f6b1ccb3d8252a0f9257a3974fd6901163e1f25d066145643645b0fd7c8",
 "controlRoot": "/Users/ccrt/game/guandan/lab/out/R11-v530-control"
};
const OLD_VALUES = {
 "deb088594db2766d7b1dadf0bad610e3ba7b02afd613764594f55e0ab7386cde": {
  "schema": "ohuo-first-round-budget-allocation-rule-v1",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "pilotSelectionRuleRef": "v530-pilot-selection-rule@sha256:d456d822e66fd41d296abf21e7f9e4b4cd3c89d633e7ae0bc3765696b57c549a",
  "pilotReadoutRuleRef": "v530-pilot-cost-contract@sha256:9e1d6abb95d5528162f9a4f9ae9171b72737bca28e9c06152eab558b56d45518",
  "stageClauses": {
   "pilot": [
    "v530-pilot-source-clause@sha256:012487082c94017597c5c1033794c8ffa7fe84fe43ce1cb50c86fe50f7cada69",
    "v530-pilot-glm-clause@sha256:26125fa9d00f783929fc70be7eee0aff58eb9d3a82f52c4fbf7ad6567cb9b14a",
    "v530-pilot-screen-clause@sha256:a7a21cb31dcc290fbc0dd929b6ec31b21fc249d6b111f6bf3eca8ed049dd9def",
    "v530-pilot-ds-clause@sha256:f0e48c747505ee670033e79c6a4a22563f1bd24e33a0723141275f09d6513fae"
   ],
   "data": [
    "v530-data-source-clause@sha256:40c4b6497a4b6f7e01f32421c6ed35694b70dc1634750cb7a55ad6eae6b0b6dd",
    "v530-data-glm-clause@sha256:f79ffbd680c8b77dcb94704d194565634280148d564d1fbac7e447577820501d",
    "v530-data-screen-clause@sha256:90c0eecbe02dcf05e38a690e8c9b2c05b6fe214f22183f0829ebd3ad1d81a41d",
    "v530-data-ds-clause@sha256:fd6ec56ad260e095ff3779ed61b67b462367ddbacfb018690160658c8bbccfe9"
   ],
   "training": [
    "v530-training-calibration-clause@sha256:817f4dd610c93c154f864ee7df4600ecc0605e5ca2087acfc49da8702efcfc1f",
    "v530-training-formal-clause@sha256:01058bf9680a0535c92539c2c5a1da5a75eb8417d4d4dc0ccaa9db443a2d0d31"
   ],
   "newTest": [
    "v530-new-test-source-clause@sha256:5322863ddfb452152adeedde253f76384dac182b1882cda81765aed8b0f6c22b",
    "v530-new-test-glm-clause@sha256:61a840a3131b253c4659348fd239f68ea14924b2b352efa8286000cc340e7fbe",
    "v530-new-test-screen-clause@sha256:bf55f78de6063310722a530a611ab18bb75581c5baf2487530f29753a22c8ffd",
    "v530-new-test-ds-clause@sha256:0849bbe9ad430ec6cfdc6cd74c51198155d5fc1658dbb081f4b7802400b139b7"
   ],
   "variancePilot": [
    "v530-variance-pilot-source-clause@sha256:bf804f772ed18452dbe666e29b1068ea0ed4a0289794e039ea8ca333545177da"
   ],
   "confirmation": [
    "v530-confirmation-source-clause@sha256:8fb3161617e05dc6334d822ca31d9b8c1da971139d508fe66f361701c8e8d7fa"
   ]
  }
 },
 "9c02a3405b477d5aa8320d58100caea1b887786c03d0a52f33d6b1581367a024": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "original-outcome-blind-confirmation-N-freeze",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 },
 "9c0ca19aaf2faee748b48b9066d028fd87eabdffbdba6f13bb7d0c21c36ba4a8": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "budget-scope",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "190e34ea3f095573a888109a4c2e93357667d64dc6d5f85ab003549878a3b9a7": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "confirmation-isolation",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "c0a863ad6584fbf73bf51a6f2b0bd5cb5200bf8b4c9f6ca69e2634dd74e30130": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "frozen-comparison-conditions",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "bb3e34b3f1abd993f8c20654771579183f2bea9f25536ad5f170ffa96c76b9b2": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "new-source-isolation",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "56c1613d5b8be7b651a00f01c8317a40ae45dcfc8760cd83674d32eb1212387e": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "student-selection",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "55e28c1f3c3146b30ea7f385deea5f85d7e9a76eb4278f7ba72ae484846b5cc8": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "confirmation-paired-complete-match",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 },
 "647b24346570ffdeb6b5a20a513c30048ed1c8ea8a3fbe70e374bd0d51f01c10": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "data-ds",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "8d0a92b7ff21753e849c7560f62ed5647e17e95efa5b2f1937398a2d47eee956": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 4,
  "phase": null,
  "kind": "budget-scope",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "69ad0a541801b0b4381077fb26eaf865893f3db27c8ce501311e3cb11e420cf6": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 4,
  "phase": null,
  "kind": "frozen-source-layout",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "9439b40fdff913d4fb9137675f3a59c25eae08638a651d1c4d202052b48eab23": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 4,
  "phase": null,
  "kind": "selection-production",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "e2fceb6513cbb7665e91db90c603babff358005694536a723c6863464412830c": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 4,
  "phase": null,
  "kind": "student-visibility-and-initial-c",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "08829b17ee4e63945708d19bc37627de0bcfa9032aa40218c5d05d4ffabf5b54": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 4,
  "phase": null,
  "kind": "teacher-transferability",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "9c2a3daef8fa8f82ae9d92128961c272eb2485135d218ed0b6d70c61652e8b8f": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "data-glm",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "d711980392ccec8425cb7210a1cc8993903920369bb93b642f0afcdea7464fc9": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "data-screen",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "6386ec415c164208232d51f1182f9b3aadcec852eaad532ee4fc8e51537d7b07": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "offline-selection",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope"
  ]
 },
 "3d98793e8b25ec17762bbe07fba6ba4e84ce2f365ded22edf9321bb4d2fe3e33": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "data-complete-natural-source",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope"
  ]
 },
 "500f35cba08e7511204e54b104157036cf17b6eeebe736f8a5bcc603787269ba": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "original-B09-freeze-qualified-dataset",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "06fd5c20f5a202c39be9573951cb02e043cd471623c378389009fe9a32876552": {
  "schema": "ohuo-offline-teacher-ref-v1",
  "releaseRef": "v530-research-h-release@sha256:3fdff7473e7dd1983ad3560391087197ba2e8629f83ae377a6bde7a8924a62cc",
  "profileRevisionRef": {
   "profileId": "ohuo-deepseek-2b16f674-ee12-4694-ae40-4400eb397d54",
   "revision": 1,
   "snapshotHash": "c519671d029f432f45cd4cdcaa562715b10eae8b6e99c8ea3eb53a984d7d6225"
  }
 },
 "36cf8a9ef700f8ec02ca74ad2a96dc6c8427b8c850519430a245882d134f9e37": {
  "schema": "ohuo-offline-teacher-ref-v1",
  "releaseRef": "v530-research-h-release@sha256:3fdff7473e7dd1983ad3560391087197ba2e8629f83ae377a6bde7a8924a62cc",
  "profileRevisionRef": {
   "profileId": "ohuo-glm-8524b64b-4af1-40d4-a201-cc9ba8621c1f",
   "revision": 1,
   "snapshotHash": "9afff5a677a4f17287c39b19263851e1c5baa62e3d24ffe228ad984b1a22ac17"
  }
 },
 "71728c598d53a75e5ce7713c34c7294c8ed7391259f120e7f9c8fc5f6890322b": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "new-test-ds",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation",
   "selection-production"
  ]
 },
 "4386e4fcf567849c2346bdfa77a64542442029c06558396941c739730c23e044": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 6,
  "phase": null,
  "kind": "selection-production",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "324f11bb79b1b8e6e22c25a49fc25dbcf8cc516cb2068b08942aa3a0deaac043": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "new-test-glm",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation",
   "selection-production"
  ]
 },
 "73095c6aa4d4d341dc2a856822a9993e871d2dcf2915e3427426c1afeccb482c": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "new-test-screen",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation",
   "selection-production"
  ]
 },
 "ce1f3bf3f92cb652143cd9b03f0251111bed91971d924ab27fd1d79cc2095c95": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "first-round-new-test-selection",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 },
 "085ffc6c7dbaf624cab3aecddf08470c8d63b7b8358e6aaf420275b379d1d85f": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "independent-new-test-paired-natural-source",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 },
 "570e9fa206d5e3ca446e47a59911e9c9ca82172b5ac0ddc9cdec98238fb17ed6": {
  "schema": "ohuo-first-round-source-spec-v1",
  "purpose": "first-round-source-plan",
  "outputId": "R11-first-round-source-reservation-v1",
  "reservationRef": null,
  "planRef": "v530-approved-round-one-plan@sha256:0c27ae09bddc76791008ea5ee37bc0bf1818151654b6a951191774ad3cbe402c",
  "rulesRef": "v530-original-rules@sha256:948ce419c65fe7f29586503f79c4aa40cffdfecd75d358df9a524f90722c7b64",
  "seed": 20261101,
  "registryRef": {
   "id": "v530-original-no-h-registry",
   "sha256": "d34a08fbc5db833ca5580670ef87e11cda03bd215eb1de2c318e04dd1e236202"
  },
  "partnerPolicyIds": [
   "legacy-review5-control-p1-ck400-encv4-candv3",
   "legacy-review5-control-p2-ck400-encv4-candv3",
   "legacy-review5-control-p3-ck400-encv4-candv3"
  ],
  "opponentPolicyId": "frozenChampion-clean2-ck7051-encv1-candv2",
  "comparisonRef": "v530-comparison@sha256:ffa9d509d7f40bbe9eecf095aa106dfdfd972bd01dd867a1c8a27abc4d95e8af",
  "bindings": {
   "partnerRefs": [
    "v530-control-partner-1@sha256:51efc694b0d4a3579279136670e4335cda12c5b044df6378224c9916def4615e",
    "v530-control-partner-2@sha256:4db10e5f2695e24dd896cc40f332594174aef2d299bea42c0fbaa4770e7d59a6",
    "v530-control-partner-3@sha256:311e67510d89f66e70580d6693d1ed7823ee6ea78f19eeab998c6c7fef6e08d3"
   ],
   "opponentRef": "v530-opponent-o@sha256:8ca2d125dd112377a9cd8cd9f01da1cd38ee53df0463965f97c81fc6f32fe5df",
   "s0Ref": "v530-s0-composite@sha256:008546e796796429c8819a8973ab66c7c3f90742da08885f9222db5ed243543d",
   "s1Ref": null,
   "s1ReleaseFileRef": null
  },
  "stages": {
   "pilot": {
    "namespace": "ohuo-v530-r1-pilot",
    "dealNamespace": "ohuo-v530-r1-pilot-deals",
    "activeCount": 2
   },
   "formal": {
    "namespace": "ohuo-v530-r1-formal",
    "dealNamespace": "ohuo-v530-r1-formal-deals",
    "activeCount": 4
   },
   "newTest": {
    "namespace": "ohuo-v530-r1-newTest",
    "dealNamespace": "ohuo-v530-r1-newTest-deals",
    "activeCount": null
   },
   "variancePilot": {
    "namespace": "ohuo-v530-r1-variancePilot",
    "dealNamespace": "ohuo-v530-r1-variancePilot-deals",
    "activeCount": null
   },
   "confirmation": {
    "namespace": "ohuo-v530-r1-confirmation",
    "dealNamespace": "ohuo-v530-r1-confirmation-deals",
    "activeCount": null
   }
  },
  "confirmationPlanningRef": null,
  "exclusionIndexRefs": [
   {
    "id": "v530-legacy-exclusion-only-view",
    "sha256": "f192fbededae633451197a64a69a3e0b43cd3b4b68c75b10b362b9129b380297"
   }
  ]
 },
 "53a606c9f2c76fea2c0fcdbf817471e6cf263ed3ca5b65c390f96d903b602130": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "pilot-ds",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "dd4987a5a005e05bb49399aceeaed5c8e9b76e360b8ca77f26197c3460106a26": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "pilot-glm",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "2489caa75bbb940470571f96fcb4a90c6749d44e4e020b007ccb32dfcff3faf5": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "pilot-screen",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope",
   "selection-production"
  ]
 },
 "db291545b56c31d1814ae8b64368194198d8197aa9c27f0da41f18be77977d59": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "pilot-complete-natural-source",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "student-visibility-and-initial-c",
   "frozen-source-layout",
   "budget-scope"
  ]
 },
 "ddec40958ef7e145f1f64e1eee46e6810820a4c96809a788c3f22b6776e98443": {
  "schema": "ohuo-common-view-prompt-r2",
  "viewSchema": "first-round-common-view-r2",
  "systemPromptSHA256": "dfe4025f08ce991a6b100f93f53ff7e7415c5d2087ba2e1573d119616b2f8469"
 },
 "af73fc447d46d59deabcb8fc46ffdb6824538dee6cf52da84422fe1db540172e": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": "closeout",
  "phase": null,
  "purpose": "NAV-R17-final-report-and-original-plan-closeout",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": []
 },
 "df2ec6ab10b8ab0756b1ea776197c794aaaec7e46f3921a8f78600efe3eac735": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "original-independent-block-readout",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 },
 "ea34484daf8d0d7cffae40f2d39e7bff8c208dc7541d664162b0e1faa7c74589": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 4,
  "phase": null,
  "purpose": "original-mechanical-source-reservation",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": []
 },
 "42eb89ca3b097ebfaa9abbce271e5562fbf23275a61ce8224ca3d2c3b99e4a6f": {
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "seed": 20261101,
  "stages": {
   "pilot": {
    "namespace": "ohuo-v530-r1-pilot",
    "dealNamespace": "ohuo-v530-r1-pilot-deals",
    "activeCount": 2
   },
   "formal": {
    "namespace": "ohuo-v530-r1-formal",
    "dealNamespace": "ohuo-v530-r1-formal-deals",
    "activeCount": 4
   },
   "newTest": {
    "namespace": "ohuo-v530-r1-newTest",
    "dealNamespace": "ohuo-v530-r1-newTest-deals",
    "activeCount": null
   },
   "variancePilot": {
    "namespace": "ohuo-v530-r1-variancePilot",
    "dealNamespace": "ohuo-v530-r1-variancePilot-deals",
    "activeCount": null
   },
   "confirmation": {
    "namespace": "ohuo-v530-r1-confirmation",
    "dealNamespace": "ohuo-v530-r1-confirmation-deals",
    "activeCount": null
   }
  },
  "independentRoots": {
   "pilot": 2,
   "formal": 4,
   "newTest": 2,
   "variancePilot": 4,
   "confirmation": 8
  },
  "maxGames": 80,
  "maxMovesPerGame": 2500,
  "partnerPool": "developmentPartners",
  "purpose": "Freeze before observations. Future 80 deal families per root are ancestry, not extra independent training samples."
 },
 "8c7eeabf15c25e0d2540b5704d236a30e4602f14d66c1b1cf21eba7e56dff8e8": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 5,
  "phase": "formal",
  "purpose": "student-finalization",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "complete-formal-training",
   "frozen-behavior-review",
   "allowed-checkpoints",
   "budget-scope"
  ]
 },
 "a852e9ffee46f971a876b1496d2a5c7a939255b6ea616c2828586ae1409e5afe": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "allowed-checkpoints",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "21da7186eb45c91af25a1a821e4ff97f9a591c47a56912d1fd65d427057bac57": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "budget-scope",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "2ad1f00b9a80a86c4f6b16e123c2190edf0dc28a69983b5492402e477fd5888b": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "complete-formal-training",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "ae2f3af35f2286842370c8d9ce15ab59af94c5b6bca6109a1dcbebc14c439f5a": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "frozen-behavior-review",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "e695f73d17ea49ac014cda3413bbb900ebecaf57c0dd7e04921953f67ae27998": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 5,
  "phase": "calibration",
  "purpose": "supervised-rerank-calibration",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "dataset-qualification",
   "fixed-parent-recipe",
   "budget-scope"
  ]
 },
 "a48818f4d2b94c42955b267c6b2f3d71bc504156d112833719eb76b1a1ce16e4": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "calibration",
  "kind": "budget-scope",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "e5c3f6a4e5ec6bf7c3863ced06f641151b51c9886f05aab593157b4a28ae7d8c": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "calibration",
  "kind": "dataset-qualification",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "8b3eda251acd395d0984b381dfd7bf6ab95123429f5e8105ee0d3d5897d6f782": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "calibration",
  "kind": "fixed-parent-recipe",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "3352dee0b2382ef0bcdc3ca3581557f28f50964925a5f9f48400d7c52becaa8c": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "calibration",
  "kind": "teacher-transferability",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "cfcda27121e95ce91bb07d57b6e8f68cbe2ce0fbeea4ab587d251b59aba9941a": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 5,
  "phase": "formal",
  "purpose": "supervised-rerank-formal",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "teacher-transferability",
   "dataset-qualification",
   "fixed-parent-recipe",
   "budget-scope",
   "calibration-qualification"
  ]
 },
 "8be1c644e480d9a2e4a4a5fe0bf8c34a0127ba8f0930b353b0d145cde1ebcfe8": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "calibration-qualification",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "b79eaadb8cd25ae4ba8471177a2f7a933328822690426e28c763e594c7126af3": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "dataset-qualification",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "094c7c93184e3d9b65a88aaa289cc603ff10cc70f7261cc732626711c8dc3c5e": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "fixed-parent-recipe",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "a04903917d3f53dd18ef14ebb7761989dc7de620447c97bdd89e4b00df0cfc51": {
  "schema": "ohuo-stage-prerequisite-v1",
  "stage": 5,
  "phase": "formal",
  "kind": "teacher-transferability",
  "sourceRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef"
 },
 "6467a1af64eacc2e155740a7f17639469f884e828e02f37be07fa6d4a11c7e94": {
  "schema": "ohuo-stage-action-rule-v1",
  "stage": 6,
  "phase": null,
  "purpose": "variance-pilot-paired-complete-match",
  "originalRuleRef": "v530-round-one-original-rule@sha256:0d26fe36ea841e4fdf2c00f8015d9499c0954eb7707ef77bdf9653c8955d07ef",
  "requiredKinds": [
   "student-selection",
   "frozen-comparison-conditions",
   "new-source-isolation",
   "budget-scope",
   "confirmation-isolation"
  ]
 }
};

/** Pure fixture constructor: each caller owns an independent reference map.
 * Current data describes compatibility only, never an accepted native revision. */
export function buildDesignedProtocolLineageFixture() {
 const previousProtocolRef=ACTUAL_LINEAGE_FIXTURE_SOURCES.protocol.ref,previousResourcePolicyRef=ACTUAL_LINEAGE_FIXTURE_SOURCES.policy.ref;
 const old=structuredClone(OLD_PROTOCOL),references=new Map([[previousProtocolRef,old],[previousResourcePolicyRef,structuredClone(OLD_POLICY)]]);
 const oldRefs=[...Object.values(old.originalMethods),...old.actions.flatMap(a=>[a.acceptanceRuleRef,...a.dependencyRefs])];
 for(const ref of oldRefs){const value=structuredClone(OLD_VALUES[ref.split(':').at(-1)]);assert.equal(digest(value),ref.split(':').at(-1));references.set(ref,value);}
 const add=(id,value)=>{const ref=referenceOf(id,value);references.set(ref,value);return ref;};
 const current=structuredClone(old);
 current.originalMethods={...current.originalMethods,previousProtocolRef,previousResourcePolicyRef,commonViewPromptRef:add('fixture-v541-project-rules-prompt',{schema:PROJECT_RULES_TEACHER_PROMPT_SCHEMA,promptId:PROJECT_RULES_TEACHER_PROMPT_ID,wireSchema:PROJECT_RULES_TEACHER_WIRE_SCHEMA,viewSchema:'first-round-common-view-r2',systemPromptSHA256:PROJECT_RULES_TEACHER_SYSTEM_SHA256,ruleOptions:{...PROJECT_RULE_OPTIONS}})};
 current.scientificDocument={id:'fixture-current-v541-scientific-document',sha256:'a'.repeat(64)};
 current.authorizationEvidence=[{id:'fixture-current-v541-authorization-evidence',sha256:'b'.repeat(64)}];
 for(const action of current.actions){
  const original=references.get(action.acceptanceRuleRef),rule=structuredClone(original);
  if(rule.schema==='ohuo-stage-action-rule-v1'&&rule.stage===4&&rule.phase===null&&rule.purpose==='offline-selection'&&action.plannedTaskIds.length===0){
   action.dependencyRefs=action.dependencyRefs.map((ref,i)=>add('fixture-current/offline-selection/'+action.clauseRef.split('@')[0]+'/'+i,structuredClone(references.get(ref))));
  }
  if(rule.stage===4&&rule.phase===null&&rule.purpose==='original-mechanical-source-reservation'){
   action.expectedArtifactKinds.push('ohuo-designed-family-reservation-v1','ohuo-designed-source-acceptance-v1');
   rule.requiredKinds.push('designed-public-train-gap','student-visibility-and-initial-c','budget-scope');
   action.dependencyRefs=rule.requiredKinds.map(kind=>add('fixture-current/source-owner/'+kind,{schema:'ohuo-stage-prerequisite-v1',stage:4,phase:null,kind,sourceRuleRef:rule.originalRuleRef}));
   action.acceptanceRuleRef=add('fixture-current/source-owner-rule',rule);
  }
  if(rule.stage===4&&rule.phase===null&&['data-complete-natural-source','data-glm','data-screen','data-ds'].includes(rule.purpose)||rule.stage===5&&['calibration','formal'].includes(rule.phase)&&rule.purpose==='supervised-rerank-'+rule.phase){
   action.plannedTaskIds.push('fixture-added-'+rule.purpose);
   action.dependencyRefs=action.dependencyRefs.map((ref,i)=>add('fixture-current/'+rule.purpose+'/'+i,structuredClone(references.get(ref))));
   if(rule.purpose==='data-complete-natural-source'){
    rule.purpose='designed-source';rule.requiredKinds.push('designed-public-train-gap');
    action.dependencyRefs.push(add('fixture-current/designed-public-train-gap',{schema:'ohuo-stage-prerequisite-v1',stage:4,phase:null,kind:'designed-public-train-gap',sourceRuleRef:rule.originalRuleRef}));
    action.expectedArtifactKinds.push('ohuo-designed-source-summary-v1');
    action.acceptanceRuleRef=add('fixture-current/designed-source-rule',rule);
   }
  }
 }
 const currentProtocolRef=add('fixture-current-v541-protocol',current);
 return {references,currentProtocolRef,previousProtocolRef,previousResourcePolicyRef};
}

export function runDesignedProtocolLineageSmoke() {
 let passed=0;
 const check=(name,fn)=>{fn();passed++;process.stdout.write('ok '+name+'\n');};
 const revise=(fixture,edit)=>{const value=structuredClone(fixture.references.get(fixture.currentProtocolRef));edit(value,fixture);fixture.currentProtocolRef=referenceOf('fixture-current-mutated',value);fixture.references.set(fixture.currentProtocolRef,value);return fixture;};
 const put=(f,id,value)=>{const ref=referenceOf(id,value);f.references.set(ref,value);return ref;};
 const actionFor=(f,p,purpose)=>p.actions.find(a=>f.references.get(a.acceptanceRuleRef).purpose===purpose);
 const reject=(name,edit)=>check(name,()=>{const f=buildDesignedProtocolLineageFixture();edit(f);assert.throws(()=>verifyDesignedProtocolLineage(f),undefined,name);});
 check('actual old snapshot digests and fixed identities',()=>{const f=buildDesignedProtocolLineageFixture();assert.equal(digest(OLD_VALUES),ACTUAL_LINEAGE_FIXTURE_SOURCES.referenceValuesSHA256);for(const [ref,value]of f.references)assert.equal(digest(value),ref.split(':').at(-1));assert.equal(f.previousProtocolRef,ACTUAL_LINEAGE_FIXTURE_SOURCES.protocol.ref);});
 check('compatible actual-old to current pair returns only exact three references',()=>{const f=buildDesignedProtocolLineageFixture(),before=JSON.stringify([...f.references]);assert.deepEqual(verifyDesignedProtocolLineage(f),{currentProtocolRef:f.currentProtocolRef,previousProtocolRef:f.previousProtocolRef,previousResourcePolicyRef:f.previousResourcePolicyRef});assert.equal(JSON.stringify([...f.references]),before);});
 check('unchanged old prompt is also compatible',()=>{const f=revise(buildDesignedProtocolLineageFixture(),p=>{p.originalMethods.commonViewPromptRef=OLD_PROTOCOL.originalMethods.commonViewPromptRef;});assert.doesNotThrow(()=>verifyDesignedProtocolLineage(f));});
 check('reference map with only read access is supported',()=>{const f=buildDesignedProtocolLineageFixture();f.references={get:f.references.get.bind(f.references)};assert.doesNotThrow(()=>verifyDesignedProtocolLineage(f));});
 reject('current reference missing',f=>f.references.delete(f.currentProtocolRef));
 reject('previous reference missing',f=>f.references.delete(f.previousProtocolRef));
 reject('current digest mismatch',f=>f.references.get(f.currentProtocolRef).planVersion++);
 reject('previous digest mismatch',f=>f.references.get(f.previousProtocolRef).planVersion++);
 reject('current reference is mutable',f=>{f.currentProtocolRef='latest';});
 reject('old policy missing',f=>f.references.delete(f.previousResourcePolicyRef));
 reject('old policy digest mismatch',f=>f.references.get(f.previousResourcePolicyRef).mode='other');
 for(const field of ['protocolRevisionRef','planRef','budgetRef'])reject('old policy '+field+' mismatch',f=>revise(f,(p)=>{const policy={...f.references.get(f.previousResourcePolicyRef),[field]:referenceOf('fixture-other',{field})};p.originalMethods.previousResourcePolicyRef=put(f,'fixture-wrong-policy',policy);}));
 reject('old policy validator rejects changed mode',f=>revise(f,p=>{p.originalMethods.previousResourcePolicyRef=put(f,'fixture-policy-mode',{...f.references.get(f.previousResourcePolicyRef),mode:'quota'});}));
 reject('lineage link names a different old protocol',f=>revise(f,p=>{p.originalMethods.previousProtocolRef=referenceOf('fixture-wrong-old',{});}));
 reject('unknown lineage method',f=>revise(f,p=>{p.originalMethods.otherRef=p.originalMethods.primaryTeacherRef;}));
 for(const field of ['sourceSpecRef','sourceReservationRuleRef','primaryTeacherRef','independentTeacherRef'])reject('unchanged method '+field+' cannot swap',f=>revise(f,p=>{p.originalMethods[field]=put(f,'fixture-swapped-method',{schema:'not-original'});}));
 reject('new prompt must be exact accepted project rules',f=>revise(f,p=>{const prompt={...f.references.get(p.originalMethods.commonViewPromptRef),systemPromptSHA256:'c'.repeat(64)};p.originalMethods.commonViewPromptRef=put(f,'fixture-invalid-prompt',prompt);}));
 reject('old original method registry must resolve',f=>f.references.delete(OLD_PROTOCOL.originalMethods.sourceSpecRef));
 for(const [field,value]of [['protocolId','other-protocol'],['planRef',referenceOf('other-plan',{})],['budgetRef',referenceOf('other-budget',{})],['planVersion',2]])reject('identity '+field+' unchanged',f=>revise(f,p=>{p[field]=value;}));
 reject('unknown protocol fields rejected',f=>revise(f,p=>{p.authorized=true;}));
 reject('removed action',f=>revise(f,p=>{p.actions.pop();}));
 reject('duplicate clause and branch',f=>revise(f,p=>{p.actions[p.actions.length-1]=structuredClone(p.actions[0]);}));
 for(const field of ['clauseRef','branchRef','skipRuleRef','stopRuleRef'])reject('protected action '+field,f=>revise(f,p=>{p.actions[0][field]=referenceOf('replacement',{});}));
 reject('old Task ID removed',f=>revise(f,p=>{actionFor(f,p,'data-glm').plannedTaskIds.shift();}));
 reject('duplicate Task ID in action',f=>revise(f,p=>{const a=actionFor(f,p,'data-glm');a.plannedTaskIds.push(a.plannedTaskIds[0]);}));
 reject('Task reused across action roles',f=>revise(f,p=>{actionFor(f,p,'data-glm').plannedTaskIds.push(actionFor(f,p,'data-screen').plannedTaskIds[0]);}));
 reject('new Task outside stage4/5 roles',f=>revise(f,p=>{actionFor(f,p,'new-test-glm').plannedTaskIds.push('fixture-stage6-addition');}));
 reject('student finalization is not same-recipe training',f=>revise(f,p=>{actionFor(f,p,'student-finalization').plannedTaskIds.push('fixture-finalization-addition');}));
 reject('pilot role cannot add Tasks',f=>revise(f,p=>{actionFor(f,p,'pilot-glm').plannedTaskIds.push('fixture-pilot-addition');}));
 reject('removed artifact declaration',f=>revise(f,p=>{actionFor(f,p,'data-glm').expectedArtifactKinds=[];}));
 reject('unknown artifact addition',f=>revise(f,p=>{actionFor(f,p,'designed-source').expectedArtifactKinds.push('ohuo-new-unreviewed-artifact');}));
 reject('artifact added to wrong role',f=>revise(f,p=>{actionFor(f,p,'data-screen').expectedArtifactKinds.push('ohuo-designed-family-reservation-v1');}));
 reject('old prerequisite removed',f=>revise(f,p=>{actionFor(f,p,'data-glm').dependencyRefs.shift();}));
 reject('dependency alias requires full JSON equality',f=>revise(f,p=>{const a=actionFor(f,p,'data-glm'),old=f.references.get(a.dependencyRefs[0]);a.dependencyRefs[0]=put(f,'fixture-changed-requirement',{...old,sourceRuleRef:referenceOf('different-source-rule',{})});}));
 reject('duplicate requirement kind via alias',f=>revise(f,p=>{const a=actionFor(f,p,'data-glm');a.dependencyRefs.push(put(f,'fixture-duplicate-requirement',f.references.get(a.dependencyRefs[0])));}));
 reject('new prerequisite kind cannot create an approval framework',f=>revise(f,p=>{const a=actionFor(f,p,'designed-source');a.dependencyRefs.push(put(f,'fixture-extra-approval',{schema:'ohuo-stage-prerequisite-v1',stage:4,phase:null,kind:'new-approval',sourceRuleRef:f.references.get(a.acceptanceRuleRef).originalRuleRef}));}));
 reject('source gap required for migrated designer role',f=>revise(f,p=>{const a=actionFor(f,p,'designed-source');a.dependencyRefs=a.dependencyRefs.filter(ref=>f.references.get(ref).kind!=='designed-public-train-gap');}));
 reject('rule purpose cannot change teacher role',f=>revise(f,p=>{const a=actionFor(f,p,'data-glm');a.acceptanceRuleRef=put(f,'fixture-changed-purpose',{...f.references.get(a.acceptanceRuleRef),purpose:'designed-source'});}));
 reject('resolved stage controls additions not names',f=>revise(f,p=>{const a=actionFor(f,p,'data-glm');a.acceptanceRuleRef=put(f,'stage4-data-glm-rule',{...f.references.get(a.acceptanceRuleRef),stage:6});}));
 reject('original rule identity retained',f=>revise(f,p=>{const a=actionFor(f,p,'designed-source');a.acceptanceRuleRef=put(f,'fixture-changed-origin',{...f.references.get(a.acceptanceRuleRef),originalRuleRef:referenceOf('other-original-rule',{})});}));
 reject('old requiredKind cannot be removed',f=>revise(f,p=>{const a=actionFor(f,p,'designed-source'),r=structuredClone(f.references.get(a.acceptanceRuleRef));r.requiredKinds.shift();a.acceptanceRuleRef=put(f,'fixture-removed-kind',r);}));
 reject('stage5 required rule cannot change',f=>revise(f,p=>{const a=actionFor(f,p,'supervised-rerank-formal'),r=structuredClone(f.references.get(a.acceptanceRuleRef));r.requiredKinds.push('designed-public-train-gap');a.acceptanceRuleRef=put(f,'fixture-training-change',r);}));
 reject('acceptance rule must be registered',f=>{const p=f.references.get(f.currentProtocolRef);f.references.delete(actionFor(f,p,'data-glm').acceptanceRuleRef);});
 reject('requirement digest cannot be forged',f=>{const p=f.references.get(f.currentProtocolRef),a=actionFor(f,p,'data-glm');f.references.get(a.dependencyRefs[0]).kind='wrong';});
 check('lineage alone leaves every original action and prompt untouched',()=>{const f=revise(buildDesignedProtocolLineageFixture(),p=>{p.actions=structuredClone(OLD_PROTOCOL.actions);p.originalMethods.commonViewPromptRef=OLD_PROTOCOL.originalMethods.commonViewPromptRef;});assert.doesNotThrow(()=>verifyDesignedProtocolLineage(f));});
 reject('source owner cannot gain a Task',f=>revise(f,p=>{actionFor(f,p,'original-mechanical-source-reservation').plannedTaskIds.push('fixture-owner-task');}));
 reject('source owner cannot acquire an arbitrary prerequisite',f=>revise(f,p=>{const a=actionFor(f,p,'original-mechanical-source-reservation'),r=structuredClone(f.references.get(a.acceptanceRuleRef));r.requiredKinds.push('frozen-source-layout');a.acceptanceRuleRef=put(f,'fixture-owner-extra-kind',r);}));
 reject('source owner artifacts need all original owner prerequisites',f=>revise(f,p=>{const a=actionFor(f,p,'original-mechanical-source-reservation'),r=structuredClone(f.references.get(a.acceptanceRuleRef));r.requiredKinds=r.requiredKinds.filter(k=>k!=='budget-scope');a.dependencyRefs=a.dependencyRefs.filter(ref=>f.references.get(ref).kind!=='budget-scope');a.acceptanceRuleRef=put(f,'fixture-owner-no-budget',r);}));
 reject('source owner requirement must name original source rule',f=>revise(f,p=>{const a=actionFor(f,p,'original-mechanical-source-reservation'),r=f.references.get(a.dependencyRefs[0]);a.dependencyRefs[0]=put(f,'fixture-owner-replaced-rule',{...r,sourceRuleRef:referenceOf('unrelated-rule',{})});}));
 reject('source owner cannot declare designer-summary output',f=>revise(f,p=>{actionFor(f,p,'original-mechanical-source-reservation').expectedArtifactKinds.push('ohuo-designed-source-summary-v1');}));
 reject('unmodified stage6 requirement must be registered',f=>{const p=f.references.get(f.currentProtocolRef);f.references.delete(actionFor(f,p,'new-test-glm').dependencyRefs[0]);});
 reject('unmodified stage6 requirement digest must match',f=>{const p=f.references.get(f.currentProtocolRef),a=actionFor(f,p,'new-test-glm');f.references.get(a.dependencyRefs[0]).kind='forged';});
 reject('evidence digest must be a string',f=>revise(f,p=>{p.scientificDocument.sha256=['a'.repeat(64)];}));
 check('both actual offline-selection actions allow only same-value namespace aliases',()=>{const f=buildDesignedProtocolLineageFixture(),p=f.references.get(f.currentProtocolRef),old=f.references.get(f.previousProtocolRef),actions=p.actions.filter(a=>f.references.get(a.acceptanceRuleRef).purpose==='offline-selection');assert.equal(actions.length,2);for(const a of actions){const previous=old.actions.find(x=>x.clauseRef===a.clauseRef&&x.branchRef===a.branchRef);assert.notDeepEqual(a.dependencyRefs,previous.dependencyRefs);assert.deepEqual({...a,dependencyRefs:previous.dependencyRefs},previous);assert.deepEqual(a.dependencyRefs.map(ref=>f.references.get(ref)),previous.dependencyRefs.map(ref=>f.references.get(ref)));}assert.doesNotThrow(()=>verifyDesignedProtocolLineage(f));});
 const selectionAction=(f,p)=>actionFor(f,p,'offline-selection');
 for(const field of ['kind','sourceRuleRef','stage','phase'])reject('offline selection alias preserves requirement '+field,f=>revise(f,p=>{const a=selectionAction(f,p),old=f.references.get(a.dependencyRefs[0]),value=field==='sourceRuleRef'?referenceOf('fixture-other-source-rule',{}):field==='stage'?5:field==='phase'?'formal':'other-kind';a.dependencyRefs[0]=put(f,'fixture-selection-change-'+field,{...old,[field]:value});}));
 reject('offline selection alias cannot omit a requirement',f=>revise(f,p=>{selectionAction(f,p).dependencyRefs.pop();}));
 reject('offline selection alias cannot add a requirement',f=>revise(f,p=>{const a=selectionAction(f,p);a.dependencyRefs.push(put(f,'fixture-selection-added',{schema:'ohuo-stage-prerequisite-v1',stage:4,phase:null,kind:'designed-public-train-gap',sourceRuleRef:f.references.get(a.acceptanceRuleRef).originalRuleRef}));}));
 reject('offline selection alias cannot reorder requirements',f=>revise(f,p=>{selectionAction(f,p).dependencyRefs.reverse();}));
 reject('offline selection alias must resolve registered bytes',f=>{const p=f.references.get(f.currentProtocolRef);f.references.delete(selectionAction(f,p).dependencyRefs[0]);});
 reject('offline selection alias cannot add a Task',f=>revise(f,p=>{selectionAction(f,p).plannedTaskIds.push('fixture-unapproved-selection-task');}));
 reject('offline selection alias cannot add an artifact',f=>revise(f,p=>{selectionAction(f,p).expectedArtifactKinds.push('ohuo-designed-family-reservation-v1');}));
 reject('offline selection alias cannot change acceptanceRuleRef even to equal JSON',f=>revise(f,p=>{const a=selectionAction(f,p);a.acceptanceRuleRef=put(f,'fixture-selection-rule-alias',f.references.get(a.acceptanceRuleRef));}));
 reject('offline selection alias cannot remove old requiredKinds',f=>revise(f,p=>{const a=selectionAction(f,p),rule=structuredClone(f.references.get(a.acceptanceRuleRef));rule.requiredKinds.pop();a.acceptanceRuleRef=put(f,'fixture-selection-rule-kind',rule);}));
 reject('stage6 selection cannot use new dependency namespace aliases',f=>revise(f,p=>{const a=actionFor(f,p,'first-round-new-test-selection');a.dependencyRefs=a.dependencyRefs.map((ref,i)=>put(f,'fixture-stage6-selection-alias/'+i,f.references.get(ref)));}));
 // A second approved revision is a new Task on the same original ledger,
 // not a retry/rewrite of the terminal first designer. This remains pure data.
 const continuation=()=>{const f=buildDesignedProtocolLineageFixture(),rootRef=f.previousProtocolRef,rootPolicyRef=f.previousResourcePolicyRef,firstRef=f.currentProtocolRef,firstPolicyRef=put(f,'fixture-first-designed-policy',{...f.references.get(rootPolicyRef),protocolRevisionRef:firstRef}),next=structuredClone(f.references.get(firstRef));next.originalMethods.previousProtocolRef=firstRef;next.originalMethods.previousResourcePolicyRef=firstPolicyRef;actionFor(f,next,'designed-source').plannedTaskIds.push('fixture-next-independent-designed-question');for(const purpose of ['original-mechanical-source-reservation','designed-source']){const a=actionFor(f,next,purpose);a.dependencyRefs=a.dependencyRefs.map((r,i)=>put(f,'fixture-next/'+purpose+'/'+i,structuredClone(f.references.get(r))));}f.currentProtocolRef=put(f,'fixture-next-designed-protocol',next);f.previousProtocolRef=firstRef;return{...f,rootRef,rootPolicyRef,firstRef,firstPolicyRef};};
 check('designed continuation preserves first revision and exact immediate policy',()=>{const f=continuation(),before=JSON.stringify([...f.references]);assert.deepEqual(verifyDesignedProtocolLineage(f),{currentProtocolRef:f.currentProtocolRef,previousProtocolRef:f.firstRef,previousResourcePolicyRef:f.firstPolicyRef});assert.equal(JSON.stringify([...f.references]),before);});
 check('original natural ancestor remains read-only through both exact links',()=>{const f=continuation();assert.deepEqual(verifyDesignedProtocolLineage({...f,previousProtocolRef:f.rootRef}),{currentProtocolRef:f.currentProtocolRef,previousProtocolRef:f.rootRef,previousResourcePolicyRef:f.rootPolicyRef});});
 const rejectNext=(name,edit)=>check(name,()=>{const f=continuation();edit(f);assert.throws(()=>verifyDesignedProtocolLineage(f));});
 rejectNext('continuation cannot use original policy in place of immediate policy',f=>revise(f,p=>{p.originalMethods.previousResourcePolicyRef=f.rootPolicyRef;}));
 rejectNext('continuation cannot skip its requested actual predecessor',f=>revise(f,p=>{p.originalMethods.previousProtocolRef=f.rootRef;p.originalMethods.previousResourcePolicyRef=f.rootPolicyRef;}));
 rejectNext('continuation needs actual registered ancestor',f=>f.references.delete(f.rootRef));
 rejectNext('continuation cannot omit consumed first designer Task',f=>revise(f,p=>{actionFor(f,p,'designed-source').plannedTaskIds=actionFor(f,p,'designed-source').plannedTaskIds.filter(id=>id!=='fixture-added-data-complete-natural-source');}));
 rejectNext('continuation cannot change existing designer scientific rule',f=>revise(f,p=>{const a=actionFor(f,p,'designed-source');a.acceptanceRuleRef=put(f,'fixture-next-weakened-rule',{...f.references.get(a.acceptanceRuleRef),purpose:'data-complete-natural-source'});}));
 rejectNext('continuation cannot change teacher identity',f=>revise(f,p=>{p.originalMethods.primaryTeacherRef=p.originalMethods.independentTeacherRef;}));
 rejectNext('continuation owner aliases cannot change requirement data',f=>revise(f,p=>{const a=actionFor(f,p,'original-mechanical-source-reservation');a.dependencyRefs[0]=put(f,'fixture-next-altered-owner',{...f.references.get(a.dependencyRefs[0]),sourceRuleRef:referenceOf('different-rule',{})});}));
 rejectNext('continuation cannot add an unrelated stage6 Task',f=>revise(f,p=>{actionFor(f,p,'new-test-glm').plannedTaskIds.push('fixture-unapproved-next-task');}));
 rejectNext('continuation cannot hide a malformed first revision',f=>{const first=structuredClone(f.references.get(f.firstRef));actionFor(f,first,'designed-source').plannedTaskIds.shift();const badFirstRef=put(f,'fixture-malformed-first',first),badPolicyRef=put(f,'fixture-malformed-first-policy',{...f.references.get(f.firstPolicyRef),protocolRevisionRef:badFirstRef});revise(f,p=>{p.originalMethods.previousProtocolRef=badFirstRef;p.originalMethods.previousResourcePolicyRef=badPolicyRef;});f.previousProtocolRef=badFirstRef;});
 process.stdout.write(JSON.stringify({schema:'designed-protocol-lineage-smoke-v1',passed,networkCalls:0,providerCalls:0,taskStarts:0})+'\n');
 return {passed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runDesignedProtocolLineageSmoke();
