#!/usr/bin/env python3
"""Capture one pinned Codex request against a loopback-only fictional provider.

No real authentication or model endpoint is used. Report metadata only; never
print headers, request input, CLI output or inherited context. This is an
explicit integration probe, not a claim of semantic or deployment acceptance.
"""
import argparse
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import threading

EXPECTED_VERSION='codex-cli 0.149.1'


def probe(binary,model):
    binary=Path(binary)
    if not binary.is_absolute() or not binary.is_file():raise ValueError('ABSOLUTE_CODEX_BINARY_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='aibrain-codex-isolation-') as temporary:
        root=Path(temporary);home=root/'home';work=root/'work'
        home.mkdir(mode=0o700);work.mkdir(mode=0o700)
        # This process has its own intended HOME/CODEX_HOME. The calling shell's
        # environment and every existing user home remain unchanged.
        env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'HOME':str(home),'CODEX_HOME':str(home),
            'AIBRAIN_KNOWLEDGE_FIXTURE_TOKEN':'fictional-not-a-real-key'}
        version=subprocess.run([str(binary),'--version'],env=env,capture_output=True,timeout=5).stdout.decode().strip()
        if version!=EXPECTED_VERSION:return {'versionMatches':False,'requestObserved':False,'modelOnlyRequest':False}
        captures=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                self.connection.settimeout(2)
                try:
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=1024*1024:raise ValueError()
                    value=json.loads(self.rfile.read(size))
                    tools=value.get('tools',[])
                    captures.append({'pathMatches':self.path=='/v1/responses',
                        'tools':[{'type':t.get('type'),'name':t.get('name')} for t in tools],
                        'modelMatches':value.get('model')==model,
                        'emptyTools':isinstance(tools,list) and not tools})
                    # Intentionally end the request before any generation. Never
                    # relay to a real provider, log the payload or return tools.
                    self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers()
                    self.wfile.write(b'{"error":{"message":"Fictional capture complete","type":"invalid_request_error"}}')
                except (ValueError,TypeError,KeyError,OSError):
                    self.close_connection=True
        server=http.server.HTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        values={'model_provider':'fixture','model_providers.fixture.name':'Fixture',
            'model_providers.fixture.base_url':f'http://127.0.0.1:{server.server_port}/v1',
            'model_providers.fixture.env_key':'AIBRAIN_KNOWLEDGE_FIXTURE_TOKEN',
            'model_providers.fixture.wire_api':'responses','model_providers.fixture.request_max_retries':0,
            'model_providers.fixture.stream_max_retries':0,'model_providers.fixture.supports_websockets':False,
            'web_search':'disabled','features.shell_tool':False,'features.unified_exec':False,
            'features.multi_agent':False,'features.apps':False,'features.memories':False,
            'features.hooks':False,'project_doc_max_bytes':0,'tools.view_image':False}
        command=[str(binary),'exec','--ignore-user-config','--ephemeral','--skip-git-repo-check',
            '--json','--sandbox','read-only','-C',str(work),'-m',model]
        for key,value in values.items():command+=['-c',key+'='+json.dumps(value)]
        command+=['Summarize only this fictional sentence: the fictional office opens on Mondays.']
        process=None;timed_out=False
        try:
            process=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
            try:stdout,_=process.communicate(timeout=25)
            except subprocess.TimeoutExpired:
                timed_out=True;os.killpg(process.pid,signal.SIGKILL);stdout,_=process.communicate()
            # Only expose booleans for diagnostic messages. The raw output can
            # include ambient context and must not become the probe's report.
            return {'version':EXPECTED_VERSION,'versionMatches':True,'requestObserved':bool(captures),
                'requests':captures,'modelOnlyRequest':len(captures)==1 and captures[0]['emptyTools'] and captures[0]['modelMatches'],
                'timedOut':timed_out,'metadataFallback':b'Model metadata for' in stdout,
                'skillsContextWarning':b'Skill descriptions were shortened' in stdout,
                'providerGenerationPerformed':False,'semanticAcceptance':False}
        finally:
            if process and process.poll() is None:
                os.killpg(process.pid,signal.SIGKILL);process.wait()
            server.shutdown();server.server_close();thread.join(timeout=3)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--codex-bin',required=True)
    parser.add_argument('--model',default='fixture-model')
    args=parser.parse_args()
    try:result=probe(args.codex_bin,args.model)
    except (ValueError,OSError,subprocess.SubprocessError):
        result={'probeFailed':True,'modelOnlyRequest':False}
    print(json.dumps(result))
    raise SystemExit(0 if result.get('modelOnlyRequest') and not result.get('metadataFallback') else 2)
