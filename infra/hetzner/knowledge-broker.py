#!/usr/bin/env python3
"""Peer-authenticated, installation-bound Unix API for indexed knowledge."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import struct
import sqlite3
import threading
import uuid

spec = importlib.util.spec_from_file_location("retrieval",Path(__file__).with_name("knowledge-retrieval.py"))
retrieval = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retrieval)
publication,files = retrieval.publication,retrieval.files
require = retrieval.require


def validate_request(value,manifest):
    try:
        require(isinstance(value,dict) and set(value)=={"schemaVersion","installationId","connectionId","requestId","operation","audiences","input"},"INVALID_REQUEST")
        require(type(value["schemaVersion"]) is int and value["schemaVersion"]==1 and
                value["installationId"]==manifest["installationId"] and value["connectionId"]==manifest["connectionId"] and
                str(uuid.UUID(value["requestId"]))==value["requestId"],"INVALID_BINDING")
        require(isinstance(value["audiences"],list) and 1<=len(value["audiences"])<=32,"INVALID_AUDIENCES")
        keys=[publication.audience_key(a) for a in value["audiences"]]
        require(len(keys)==len(set(keys)),"DUPLICATE_AUDIENCE")
        args=value["input"]
        require(isinstance(args,dict),"INVALID_INPUT")
        if value["operation"]=="search":
            require(set(args)=={"query","limit"} and isinstance(args["query"],str) and 0<len(args["query"].strip())<=200 and
                    type(args["limit"]) is int and 1<=args["limit"]<=50,"INVALID_QUERY")
        elif value["operation"]=="read":
            require(set(args)=={"path"} and len(value["audiences"])==1,"INVALID_READ")
            retrieval.parse_reference(manifest["connectionId"],value["audiences"][0],args["path"])
        elif value["operation"]=="calculate":
            require(set(args)=={"path","tableIndex","selection","operation","locale"} and len(value["audiences"])==1,"INVALID_CALCULATION")
            retrieval.parse_reference(manifest["connectionId"],value["audiences"][0],args["path"])
            require(type(args["tableIndex"]) is int and 0<=args["tableIndex"]<10000 and args["operation"] in {"sum","count","min","max","mean"}
                    and args["locale"] in {"canonical","es","en"} and isinstance(args["selection"],dict),"INVALID_CALCULATION")
            selection=args["selection"]
            if set(selection)=={"cells"}:
                require(isinstance(selection["cells"],list) and 1<=len(selection["cells"])<=500 and
                        all(isinstance(c,str) and len(c)<=16 for c in selection["cells"]),"INVALID_SELECTION")
            else:
                require(set(selection)=={"rows","column"} and isinstance(selection["rows"],list) and 1<=len(selection["rows"])<=500 and
                        all(type(r) is int and 1<=r<=1000000 for r in selection["rows"]) and
                        type(selection["column"]) is int and 1<=selection["column"]<=10000,"INVALID_SELECTION")
        else:
            raise ValueError("INVALID_OPERATION")
        return True
    except (ValueError,TypeError,KeyError,AttributeError):
        return False


def execute(value,manifest,bindings,root):
    require(validate_request(value,manifest),"INVALID_REQUEST")
    publication.validate_bindings(bindings,manifest["installationId"])
    configured=[r["audience"] for r in bindings["rules"] if r["audience"] is not None]
    allowed=[]
    for audience in value["audiences"]:
        if audience not in configured:
            continue
        # Current scope marker is checked before opening its database.
        files.sync.scope_directory(manifest,audience)
        allowed.append(audience)
    if not allowed:
        return {"available":False,"error":"SCOPE_UNAVAILABLE"}
    reader=retrieval.Retrieval(root,manifest["installationId"],manifest["connectionId"],bindings,lambda a:a in allowed)
    if value["operation"]=="read":
        return reader.read(allowed[0],value["input"]["path"])
    if value["operation"]=="calculate":
        return reader.calculate(allowed[0],**value["input"])
    results,records,unavailable,record_bytes,expired=[],[],0,0,0
    for audience in allowed:
        try:
            result=reader.search(audience,**value["input"])
            results.extend(result["results"])
            expired+=result['freshnessOmitted']
            for record in result["knowledgeRecords"]:
                size=len(json.dumps(record,ensure_ascii=False).encode())
                if record_bytes+size<=64000 and len(records)<10:
                    records.append(record)
                    record_bytes+=size
        except (ValueError,OSError,sqlite3.DatabaseError):
            unavailable+=1
    return {"available":unavailable<len(allowed),"results":results[:value["input"]["limit"]],"knowledgeRecords":records,"checkedAt":retrieval.catalogue.now(),
            "freshnessOmitted":expired,"sourceCheckMaxAgeSeconds":86400,
            "unavailableScopes":unavailable,"truncated":len(results)>value["input"]["limit"],"freshSourceChecked":False,
            "warning":"Búsqueda en las copias indexadas de los ámbitos autorizados. La cobertura puede ser parcial; revisa las fechas y verifica el original para decisiones que dependan de datos actuales."}


class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    request_queue_size=8

    def __init__(self,address,manifest,bindings_path,root):
        self.manifest,self.bindings_path,self.root=manifest,bindings_path,root
        self.slots=threading.BoundedSemaphore(4)
        super().__init__(str(address),Handler)

    def verify_request(self,request,_):
        _,uid,_=struct.unpack("3i",request.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
        return uid==self.manifest["appUid"]


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        acquired=False
        try:
            self.connection.settimeout(5)
            raw=self.rfile.readline(16385)
            if len(raw)>16384 or not raw.endswith(b"\n"):
                return
            value=json.loads(raw)
            if not validate_request(value,self.server.manifest):
                return
            acquired=self.server.slots.acquire(blocking=False)
            if acquired:
                bindings=json.loads(files.rdp.private_file(self.server.bindings_path).read_text())
                try:
                    result=execute(value,self.server.manifest,bindings,self.server.root)
                except (ValueError,OSError,sqlite3.DatabaseError) as error:
                    result={"available":False,"error":"KNOWLEDGE_UNAVAILABLE"}
                    if isinstance(error,ValueError) and str(error) in {'SOURCE_VERSION_OR_CHECK_UNAVAILABLE','INDEXED_VERSION_UNAVAILABLE'}:
                        result.update(error='SOURCE_RECHECK_REQUIRED',warning='La versión indexada cambió, dejó de estar disponible o necesita una nueva comprobación. Puedes consultar el original autorizado mediante server:/; esto no demuestra que el archivo haya sido borrado.')
            else:
                result={"available":False,"error":"KNOWLEDGE_BUSY"}
            result.update(requestId=value["requestId"],installationId=value["installationId"],connectionId=value["connectionId"])
            response=json.dumps(result,ensure_ascii=False).encode()+b"\n"
            if len(response)<=256*1024:
                self.wfile.write(response)
        except (ValueError,OSError):
            pass
        finally:
            if acquired:
                self.server.slots.release()


def prepare_socket_directory(directory,app_gid):
    directory.mkdir(mode=0o750,exist_ok=True)
    files.sync.secure_dir(directory)
    os.chown(directory,0,app_gid)
    # The service's restrictive umask must not remove group traversal. The
    # application group needs this directory, never the private catalogue.
    os.chmod(directory,0o750)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--bindings",required=True)
    args=parser.parse_args()
    require(os.geteuid()==0,"HOST_OPERATOR_REQUIRED")
    os.umask(0o077)
    manifest=files.sync.load_manifest(args.manifest)
    bindings=publication.validate_bindings(json.loads(files.rdp.private_file(args.bindings).read_text()),manifest["installationId"])
    directory=Path(manifest["dataRootHost"])/"locks"/"knowledge"
    prepare_socket_directory(directory,manifest["appGid"])
    audiences={publication.partition_id(r["audience"]):r["audience"] for r in bindings["rules"] if r["audience"] is not None}
    descriptor=directory/(manifest["connectionId"]+".json")
    files.sync.atomic_json(descriptor,{"schemaVersion":1,"installationId":manifest["installationId"],"connectionId":manifest["connectionId"],"publications":list(audiences.values()),"mode":"read-only"})
    os.chown(descriptor,0,manifest["appGid"])
    os.chmod(descriptor,0o440)
    address=directory/(manifest["connectionId"]+".sock")
    if address.exists() or address.is_symlink():
        info=address.lstat()
        require(stat.S_ISSOCK(info.st_mode) and info.st_uid==0,"UNSAFE_SOCKET")
        with socket.socket(socket.AF_UNIX) as probe:
            try:
                probe.connect(str(address))
            except ConnectionRefusedError:
                address.unlink()
            else:
                raise ValueError("BROKER_ALREADY_RUNNING")
    root=Path("/var/lib/aibrain/knowledge")/manifest["installationId"]
    with Server(address,manifest,args.bindings,root) as server:
        os.chown(address,0,manifest["appGid"])
        os.chmod(address,0o660)
        server.serve_forever(poll_interval=0.5)


if __name__=="__main__":
    main()
