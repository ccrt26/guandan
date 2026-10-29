"""Mechanical admission for genuine no-H team batches and locked root labels."""
def validate_batch(rows):
    if len(rows)!=1024: raise ValueError('exact1024 team gradient slots required')
    counts={'self':0,'frozen_opponent':0,'other_partner':0};seen=set()
    for r in rows:
        if not isinstance(r.get('decisionId'),str) or not r['decisionId'] or r['decisionId'] in seen: raise ValueError('unique actual decision identities required')
        seen.add(r['decisionId'])
        if r.get('bucket') not in counts or type(r.get('g')) is not int or r['g'] not in (-3,-2,-1,1,2,3) or type(r.get('W')) is not int or r['W'] not in (-1,1) or type(r.get('y')) is not int or r['y']!=r['g']+r['W']: raise ValueError('original team round g plus final W required')
        counts[r['bucket']]+=1
    if counts!={'self':512,'frozen_opponent':256,'other_partner':256}: raise ValueError('cannot borrow no-H gradient slots')
    return counts

def select_label_ids(ids,book,arm):
    if arm not in ('A','B') or (arm=='A' and ids) or (arm=='B' and not ids) or len(ids)>64 or len(set(ids))!=len(ids) or any(i not in book for i in ids): raise ValueError('locked distinct teacher label identities required')
    return [book[i] for i in ids]
