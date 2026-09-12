"""Bounded, resumable reduction tree with references to original part claims.

Every part enters the tree. Reduction is semantic selection, not proof that every
meaning survives: only a human can accept the resulting cited proposal.
"""
import json

FAN_IN = 8


def validate_claims(claims, inputs, require, text):
    allowed = {(ref['partId'], ref['claimIndex'])
               for node in inputs for claim in node['claims'] for ref in claim['references']}
    require(isinstance(claims, list) and 1 <= len(claims) <= 10, 'INVALID_REDUCTION_CLAIMS')
    total = 0
    for claim in claims:
        require(isinstance(claim, dict) and set(claim) == {'text', 'references'}, 'INVALID_REDUCTION_CLAIM')
        total += len(text(claim['text'], 1600))
        refs = claim['references']
        require(isinstance(refs, list) and 1 <= len(refs) <= 4, 'INVALID_REDUCTION_REFERENCES')
        for ref in refs:
            require(isinstance(ref, dict) and set(ref) == {'partId', 'claimIndex'}
                    and isinstance(ref['partId'], str) and type(ref['claimIndex']) is int
                    and (ref['partId'], ref['claimIndex']) in allowed, 'REDUCTION_REFERENCE_OUTSIDE_INPUT')
    require(total <= 8000, 'REDUCTION_TEXT_TOO_LARGE')
    return claims


class Hierarchy:
    def __init__(self, engine):
        self.engine = engine
        self.store = engine.store

    def next(self, job, plan, drafts, require, digest, text):
        require(set(drafts) == {part['id'] for part in plan['parts']}, 'SUMMARY_PARTS_INCOMPLETE')
        nodes = [{'id': part['id'], 'parts': 1,
                  'claims': [{'text': claim['text'], 'references': [{'partId': part['id'], 'claimIndex': index}]}
                             for index, claim in enumerate(drafts[part['id']])]}
                 for part in plan['parts']]
        level = 0
        while len(nodes) > FAN_IN:
            level += 1
            reduced = []
            for start in range(0, len(nodes), FAN_IN):
                group = nodes[start:start + FAN_IN]
                if len(group) == 1:
                    reduced.append(group[0])
                    continue
                node = f'reduce:{level}:{start // FAN_IN}'
                fingerprint = digest(group)
                row = self.store.db.execute('SELECT input_hash,claims FROM summary_reductions WHERE job=? AND node=?', (job, node)).fetchone()
                if row is None:
                    return node, group, fingerprint
                require(row['input_hash'] == fingerprint, 'REDUCTION_INPUT_CHANGED')
                claims = validate_claims(json.loads(row['claims']), group, require, text)
                reduced.append({'id': node, 'parts': sum(item['parts'] for item in group), 'claims': claims})
            nodes = reduced
        return 'synthesis', nodes, digest(nodes)

    def save(self, job, node, inputs, fingerprint, claims, require, text):
        # The caller's transaction also commits the queue checkpoint. Source
        # currency is rechecked here even though no original is copied again.
        self.engine.load(job)
        validate_claims(claims, inputs, require, text)
        self.store.db.execute('INSERT INTO summary_reductions(job,node,input_hash,claims) VALUES(?,?,?,?)',
                              (job, node, fingerprint, json.dumps(claims, ensure_ascii=False)))
