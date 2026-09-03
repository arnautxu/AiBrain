#!/usr/bin/env python3
"""Real OCR acceptance with generated fictional raster documents only."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile

spec=importlib.util.spec_from_file_location('acceptance',Path(__file__).with_name('knowledge-acceptance.py'))
acceptance=importlib.util.module_from_spec(spec);spec.loader.exec_module(acceptance)


def fixtures(folder):
    source=folder/'fictional.pdf';source.write_bytes(acceptance.text_pdf())
    paths={}
    for suffix,flag in [('.png','-png'),('.jpg','-jpeg'),('.bmp',None)]:
        prefix=folder/('raster-'+suffix[1:])
        command=['/usr/bin/pdftoppm','-f','1','-l','1','-r','120','-singlefile']
        if flag:command.append(flag)
        subprocess.run(command+[str(source),str(prefix)],check=True,capture_output=True,timeout=30)
        target=prefix.with_suffix(suffix)
        if suffix=='.bmp':
            magic,dimensions,maximum,pixels=prefix.with_suffix('.ppm').read_bytes().split(b'\n',3)
            assert magic==b'P6' and maximum==b'255'
            width,height=map(int,dimensions.split());assert len(pixels)==width*height*3
            stride=(width*3+3)//4*4;body=bytearray()
            for row in range(height-1,-1,-1):
                rgb=bytearray(pixels[row*width*3:(row+1)*width*3]);rgb[0::3],rgb[2::3]=rgb[2::3],rgb[0::3]
                body.extend(rgb);body.extend(b'\0'*(stride-width*3))
            header=b'BM'+struct.pack('<IHHI',54+len(body),0,0,54)
            dib=struct.pack('<IiiHHIIiiII',40,width,height,1,24,0,len(body),4724,4724,0,0)
            target.write_bytes(header+dib+body)
        paths[suffix]=target
    paths['.jpeg']=folder/'raster.jpeg';paths['.jpeg'].write_bytes(paths['.jpg'].read_bytes())
    return paths


def verify(extract):
    with tempfile.TemporaryDirectory(prefix='knowledge-image-acceptance-') as temporary:
        outcomes=[]
        for suffix,path in fixtures(Path(temporary)).items():
            result=extract(path,suffix)
            assert result['ok'] is True and result['tables']==[]
            assert [s['locator'] for s in result['segments']]==['image:1']
            assert 'Contrato de mantenimiento' in result['segments'][0]['content']
            assert any(w['code']=='OCR_TEXT_REQUIRES_VERIFICATION' for w in result['warnings'])
            outcomes.append({'format':suffix,'ocrTextMatched':True,'located':True,'bytes':path.stat().st_size})
        return outcomes


if __name__=='__main__':
    print(json.dumps({'fictionalOnly':True,'sandboxResults':verify(acceptance.ingest.extract_sandboxed)}))
