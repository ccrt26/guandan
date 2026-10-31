/** B04 deliberately exposes no credential revision in its UI profile. Persist
 * this nonsecret request-identity field from the already resolved private record. */
export function frozenTeacherSnapshot(publicProfile:any,record:any){
 if(!Number.isSafeInteger(record?.credentialRevision)||record.credentialRevision<1||!publicProfile||Object.hasOwn(publicProfile,'secret'))throw Error('verified nonsecret teacher credential revision required');
 return {...structuredClone(publicProfile),credentialRevision:record.credentialRevision};
}
