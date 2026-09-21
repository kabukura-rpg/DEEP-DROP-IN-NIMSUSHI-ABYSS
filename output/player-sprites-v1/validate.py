from pathlib import Path
from PIL import Image
import json,hashlib
R=Path(__file__).resolve().parent;m=json.loads((R/'animation-map.json').read_text());pal={tuple(c) for c in m['palette']};checks=[]
for n,f in m['frames'].items():
 im=Image.open(R/f['file']).convert('RGBA');pixels=list(im.getdata());sheet=Image.open(R/f['sheet']).convert('RGBA');crop=sheet.crop((f['x'],f['y'],f['x']+48,f['y']+48))
 check={'frame':n,'size':im.size== (48,48),'binaryAlpha':all(p[3] in (0,255) for p in pixels),'paletteLocked':all(p[:3] in pal for p in pixels if p[3]),'packedExactly':im.tobytes()==crop.tobytes(),'bounds':im.getbbox()}
 assert all(check[k] for k in ['size','binaryAlpha','paletteLocked','packedExactly']);checks.append(check)
for name,source in [('fall_00','normal_fall'),('boss_ascend_00','boss_ascend'),('boss_brake_00','boss_brake')]:
 assert (R/'frames'/f'{name}.png').read_bytes()==(R.parent/'player-visual-prototype-v1'/'sprites-48'/f'{source}.png').read_bytes()
assert len(checks)==35 and len(m['animations'])==15
for state in ['fall','boss_ascend','boss_brake']:
 frames=[Image.open(R/m['frames'][n]['file']).convert('RGBA') for n in m['animations'][state]['frames']]
 assert len({im.tobytes() for im in frames})==len(frames)
results={'checks':checks,'approvedBasesByteIdentical':True,'noDescendThrustInMap':'boss_descend_thrust' not in m['animations'],'artStatus':'DEV REVIEW CANDIDATES','note':'Structural validation does not certify artistic approval. In-game override screenshots are explicitly named visual-only.'}
(R/'review'/'asset-validation.json').write_text(json.dumps(results,indent=2));print('35/35 asset structural checks passed')
