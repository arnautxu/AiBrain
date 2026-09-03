#!/usr/bin/env python3
"""Source-backed entity facts, summaries and governed decisions per partition.

Generated statements are proposals. Confirmation requires a trusted reviewer;
document text and model outputs cannot grant the reviewer capability.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import uuid

spec=importlib.util.spec_from_file_location("catalogue",Path(__file__).with_name("knowledge-catalogue.py"))
catalogue=importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalogue)
require=catalogue.require
ENTITY_TYPES={"employee","customer","supplier","project","process","company","document"}


def text(value,limit):
    require(isinstance(value,str) and 0<len(value.strip())<=limit and not catalogue.SECRET.search(value)
            and not any(ord(c)<32 and c not in "\n\t" for c in value),"INVALID_KNOWLEDGE_TEXT")
    return value.strip()


class DerivedKnowledge:
    def __init__(self,store):
        self.store=store

    def verify_citation(self,citation):
        require(isinstance(citation,dict) and set(citation)=={"source","sha256","locator","quote"},"INVALID_CITATION")
        row=self.store.document(citation["source"])
        require(row and row["state"]=='indexed' and row["sha256"]==citation["sha256"],"CITATION_VERSION_UNAVAILABLE")
        require(self.store.source_current(row['source'],row['sha256']),'CITATION_SOURCE_CHECK_EXPIRED')
        locator,quote=text(citation["locator"],500),text(citation["quote"],4000)
        # Structured segments have exact parser locators. Older indexed copies
        # can cite only the precise chunk/range returned by search/read.
        payload=self.store.db.execute("SELECT 1 FROM document_payloads WHERE document=?",(row["id"],)).fetchone()
        if payload:
            structured=self.store.structured_document(row["source"],row["sha256"])
            valid=any(s.get("locator")==locator and quote in s.get("content","") for s in structured["segments"])
            if not valid:
                match=re.fullmatch(r"(.+):row:([1-9][0-9]*):column:([1-9][0-9]*)",locator)
                if match:
                    table=next((t for t in structured["tables"] if t["locator"]==match[1] and "rows" in t),None)
                    r,c=int(match[2])-1,int(match[3])-1
                    valid=bool(table and r<len(table["rows"]) and c<len(table["rows"][r]) and quote in table["rows"][r][c])
        else:
            valid=any(quote in chunk[0] for chunk in self.store.db.execute("SELECT content FROM chunks WHERE document=? AND locator=?",(row["id"],locator)))
        require(valid,"QUOTE_NOT_IN_CITED_LOCATION")
        return row["id"],locator,quote

    def propose(self,kind,entity,topic,content,citations,idempotency_key):
        require(kind in {"fact","summary","insight","decision"},"INVALID_RECORD_KIND")
        require(isinstance(entity,dict) and set(entity)=={"type","key","label"} and entity["type"] in ENTITY_TYPES,"INVALID_ENTITY")
        entity_key,label=text(entity["key"],200),text(entity["label"],200)
        topic,content=text(topic,120),text(content,8000)
        require(isinstance(citations,list) and 1<=len(citations)<=20,"INVALID_CITATIONS")
        require(isinstance(idempotency_key,str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}",idempotency_key),"INVALID_IDEMPOTENCY_KEY")
        body={"kind":kind,"entity":entity,"topic":topic,"content":content,"citations":citations}
        digest=hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        with self.store.write():
            existing=self.store.db.execute("SELECT id,input_hash FROM knowledge_records WHERE idempotency_key=?",(idempotency_key,)).fetchone()
            if existing:
                require(existing["input_hash"]==digest,"IDEMPOTENCY_CONFLICT")
                return self.get(existing["id"],include_inactive=True)
            # A new transport key does not undo a user's rejection/deletion.
            rejected=self.store.db.execute("SELECT id FROM knowledge_records WHERE input_hash=? AND status IN ('rejected','deleted')",(digest,)).fetchone()
            require(not rejected,"REJECTED_PROPOSAL_TOMBSTONE")
            dependencies=[self.verify_citation(citation) for citation in citations]
            corrected=self.store.db.execute("SELECT r.id FROM knowledge_corrections c JOIN knowledge_records r ON r.id=c.previous WHERE r.kind=? AND r.entity_type=? AND r.entity_key=? AND r.topic=? AND r.content=?",
                (kind,entity['type'],entity_key,topic,content)).fetchall()
            versions={(d[0],citation['sha256']) for citation,d in zip(citations,dependencies)}
            for old in corrected:
                previous_versions={tuple(row) for row in self.store.db.execute('SELECT document,sha256 FROM knowledge_dependencies WHERE record=?',(old[0],))}
                # Changing quote length/order or a transport key cannot revive
                # the corrected statement on the same source versions. A new
                # source version may legitimately justify a fresh proposal.
                require(versions!=previous_versions,'CORRECTED_PROPOSAL_TOMBSTONE')
            identifier=str(uuid.uuid4())
            timestamp=catalogue.now()
            self.store.db.execute("INSERT INTO knowledge_records VALUES(?,?,?,?,?,?,?,'proposed',1,?,?,?,?)",
                (identifier,kind,entity["type"],entity_key,label,topic,content,timestamp,timestamp,idempotency_key,digest))
            for citation,(document,locator,quote) in zip(citations,dependencies):
                self.store.db.execute("INSERT OR IGNORE INTO knowledge_dependencies VALUES(?,?,?,?,?)",(identifier,document,citation["sha256"],locator,quote))
            self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) VALUES(?,1,'proposed','extractor',?)",(identifier,timestamp))
            return self.get(identifier)

    def get(self,identifier,include_inactive=False):
        row=self.store.db.execute("SELECT * FROM knowledge_records WHERE id=?",(identifier,)).fetchone()
        if row is None or (not include_inactive and row["status"] not in {"proposed","confirmed"}):
            return None
        dependencies=[dict(r) for r in self.store.db.execute("SELECT d.source,k.sha256,k.locator,k.quote FROM knowledge_dependencies k JOIN documents d ON d.id=k.document WHERE k.record=?",(identifier,))]
        if row["status"] in {"proposed","confirmed"}:
            try:
                for citation in dependencies:
                    self.verify_citation(citation)
            except ValueError:
                return None if not include_inactive else {**dict(row),"status":"stale","citations":dependencies}
        conflicts=[r[0] for r in self.store.db.execute("SELECT id FROM knowledge_records WHERE id<>? AND entity_type=? AND entity_key=? AND topic=? AND kind=? AND status IN ('proposed','confirmed') AND content<>?",
            (identifier,row["entity_type"],row["entity_key"],row["topic"],row["kind"],row["content"]))]
        return {**dict(row),"citations":dependencies,"conflicts":conflicts,"certainty":"reviewed" if row["status"]=='confirmed' else "unverified-proposal"}

    def review(self,identifier,expected_revision,decision,actor,authorize):
        require(decision in {"confirm","reject","delete"} and type(expected_revision) is int,"INVALID_REVIEW")
        require(isinstance(actor,str) and str(uuid.UUID(actor))==actor and authorize(actor) is True,"REVIEWER_REQUIRED")
        with self.store.write():
            record=self.get(identifier,include_inactive=True)
            require(record and record["revision"]==expected_revision,"REVISION_CONFLICT")
            require(record["status"] in {"proposed","confirmed"},"RECORD_NOT_REVIEWABLE")
            timestamp=catalogue.now()
            if decision=='confirm':
                # Choosing a reviewed replacement preserves competing records as
                # superseded history, rather than silently deleting a conflict.
                self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) SELECT id,revision+1,'superseded',?,? FROM knowledge_records WHERE id<>? AND entity_type=? AND entity_key=? AND topic=? AND kind=? AND status='confirmed'",
                    (actor,timestamp,identifier,record["entity_type"],record["entity_key"],record["topic"],record["kind"]))
                self.store.db.execute("UPDATE knowledge_records SET status='superseded',revision=revision+1,updated=? WHERE id<>? AND entity_type=? AND entity_key=? AND topic=? AND kind=? AND status='confirmed'",
                    (timestamp,identifier,record["entity_type"],record["entity_key"],record["topic"],record["kind"]))
            status={"confirm":"confirmed","reject":"rejected","delete":"deleted"}[decision]
            self.store.db.execute("UPDATE knowledge_records SET status=?,revision=revision+1,updated=? WHERE id=?",(status,timestamp,identifier))
            self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) VALUES(?,?,?,?,?)",(identifier,expected_revision+1,decision,actor,timestamp))
            return self.get(identifier,include_inactive=True)

    def correct(self,identifier,expected_revision,content,reason,actor,authorize):
        require(type(expected_revision) is int and 1<=expected_revision<=2**31-1,"INVALID_REVIEW")
        require(isinstance(actor,str) and str(uuid.UUID(actor))==actor and authorize(actor) is True,"REVIEWER_REQUIRED")
        content,reason=text(content,8000),text(reason,1000)
        with self.store.write():
            previous=self.get(identifier,include_inactive=True)
            require(previous and previous['revision']==expected_revision,'REVISION_CONFLICT')
            require(previous['status'] in {'proposed','confirmed'},'RECORD_NOT_REVIEWABLE')
            require(content!=previous['content'],'CORRECTION_UNCHANGED')
            dependencies=[self.verify_citation(c) for c in previous['citations']]
            require(dependencies,'INVALID_CITATIONS')
            entity={'type':previous['entity_type'],'key':previous['entity_key'],'label':previous['label']}
            body={'kind':previous['kind'],'entity':entity,'topic':previous['topic'],'content':content,'citations':previous['citations']}
            digest=hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            replacement,timestamp=str(uuid.uuid4()),catalogue.now()
            self.store.db.execute("INSERT INTO knowledge_records VALUES(?,?,?,?,?,?,?,'confirmed',1,?,?,?,?)",
                (replacement,previous['kind'],entity['type'],entity['key'],entity['label'],previous['topic'],content,
                 timestamp,timestamp,'correction:'+identifier+':'+str(expected_revision),digest))
            for citation,(document,locator,quote) in zip(previous['citations'],dependencies):
                self.store.db.execute('INSERT OR IGNORE INTO knowledge_dependencies VALUES(?,?,?,?,?)',
                    (replacement,document,citation['sha256'],locator,quote))
            self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) SELECT id,revision+1,'superseded',?,? FROM knowledge_records WHERE id NOT IN (?,?) AND entity_type=? AND entity_key=? AND topic=? AND kind=? AND status='confirmed'",
                (actor,timestamp,identifier,replacement,entity['type'],entity['key'],previous['topic'],previous['kind']))
            self.store.db.execute("UPDATE knowledge_records SET status='superseded',revision=revision+1,updated=? WHERE id NOT IN (?,?) AND entity_type=? AND entity_key=? AND topic=? AND kind=? AND status='confirmed'",
                (timestamp,identifier,replacement,entity['type'],entity['key'],previous['topic'],previous['kind']))
            self.store.db.execute("UPDATE knowledge_records SET status='superseded',revision=revision+1,updated=? WHERE id=?",(timestamp,identifier))
            self.store.db.execute('INSERT INTO knowledge_corrections VALUES(?,?,?,?,?,?)',(replacement,identifier,expected_revision,reason,actor,timestamp))
            self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) VALUES(?,?,'corrected',?,?)",(identifier,expected_revision+1,actor,timestamp))
            self.store.db.execute("INSERT INTO knowledge_events(record,revision,action,actor,recorded) VALUES(?,1,'correction-confirmed',?,?)",(replacement,actor,timestamp))
            return self.get(replacement)

    def list(self,entity_type=None,entity_key=None,query=None,limit=50):
        require(type(limit) is int and 1<=limit<=100,"INVALID_LIMIT")
        clauses=["status IN ('proposed','confirmed')"]
        values=[]
        for key,value in [("entity_type",entity_type),("entity_key",entity_key)]:
            if value is not None:
                clauses.append(key+"=?")
                values.append(text(value,200))
        if query is not None:
            clauses.append("instr(lower(content||' '||label||' '||topic),lower(?))>0")
            values.append(text(query,200))
        rows=self.store.db.execute("SELECT id FROM knowledge_records WHERE "+" AND ".join(clauses)+" ORDER BY updated DESC LIMIT ?",values+[limit]).fetchall()
        return [record for row in rows if (record:=self.get(row[0])) is not None]

    def summarize_document(self,source):
        document=self.store.document(source)
        require(document and document["state"]=='indexed',"DOCUMENT_NOT_INDEXED")
        payload=self.store.structured_document(source,document["sha256"])
        candidates=[s for s in payload["segments"] if 40<=len(s["content"].strip())<=4000]
        if not candidates:
            candidates=[s for s in payload["segments"] if s["content"].strip()][:3]
        selected,seen=[],set()
        for candidate in candidates:
            quote=candidate["content"].strip()[:1500]
            if quote in seen:
                continue
            seen.add(quote)
            selected.append({"source":source,"sha256":document["sha256"],"locator":candidate["locator"],"quote":quote})
            if len(selected)==3:
                break
        require(selected,"NO_SUMMARY_PASSAGES")
        content="\n\n".join(c["quote"] for c in selected)
        key=hashlib.sha256(json.dumps([source,document["sha256"],selected],sort_keys=True).encode()).hexdigest()
        return self.propose("summary",{"type":"document","key":hashlib.sha256(document["source_key"].encode()).hexdigest(),"label":document["name"][:200]},
                            "Extracto inicial del documento",content,selected,"extractive:"+key)
