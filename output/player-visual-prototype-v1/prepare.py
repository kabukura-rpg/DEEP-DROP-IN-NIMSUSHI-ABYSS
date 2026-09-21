"""Non-production prototype only. Resample generated poses; never draw character art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, shutil
ROOT = Path(__file__).resolve().parent
GENERATED = Path('/Users/shun/.codex/generated_images/01a0ab84-568f-7d32-9a60-2e2e09e34d04')
FILES = {
 'normal_fall':'exec-122b200b-58ad-47b6-99e3-8d10a6c7fa04.png',
 'boss_ascend':'exec-f3782ea5-173b-4aad-a731-0eb6910bb36e.png',
 'boss_brake':'exec-f498c689-83cb-4510-91ab-9021f6956d93.png',
 'boss_descend_thrust':'exec-c7538f7b-10d1-462b-ac7e-926bcb6de1a8.png'
}
# Manual visual measurements of head span and face horizontal center in generated sources.
# Normalize HEAD size, not silhouette bounds: the compressed brake must stay compressed.
MEASURE = {
 'normal_fall': (596, 654),
 'boss_ascend': (535, 620),
 'boss_brake': (600, 716),
 'boss_descend_thrust': (596, 662)
}
for d in ['source', 'sprites-48', 'previews', 'backgrounds']:
 (ROOT/d).mkdir(exist_ok=True)
poses = {}
meta = {}
for name, filename in FILES.items():
 shutil.copy2(GENERATED/filename, ROOT/'source'/f'{name}.png')
 im = Image.open(GENERATED/filename).convert('RGBA')
 alpha = im.getchannel('A').point(lambda a:255 if a >= 128 else 0)
 im.putalpha(alpha)
 bounds = alpha.getbbox()
 head_span, face_x = MEASURE[name]
 scale = 24/head_span
 # A common cell-center origin; art envelopes can move with the pose.
 origin_y = (bounds[1]+bounds[3])/2
 # Nearest neighbour affine sampling puts the face on x=24 and the envelope on y=24.
 small = im.transform((48,48), Image.Transform.AFFINE,
  (1/scale,0,face_x-24/scale,0,1/scale,origin_y-24/scale),
  resample=Image.Resampling.NEAREST)
 # Remove isolated raster noise, preserving the contiguous body/tail silhouette.
 a=small.getchannel('A'); pixels=a.load(); seen=set(); components=[]
 for y in range(48):
  for x in range(48):
   if not pixels[x,y] or (x,y) in seen: continue
   todo=[(x,y)]; seen.add((x,y)); component=[]
   while todo:
    px,py=todo.pop(); component.append((px,py))
    for dx,dy in [(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)]:
     q=(px+dx,py+dy)
     if 0<=q[0]<48 and 0<=q[1]<48 and q not in seen and pixels[q[0],q[1]]:
      seen.add(q);todo.append(q)
   components.append(component)
 for component in components:
  if len(component)<3:
   for xy in component:pixels[xy[0],xy[1]]=0
 small.putalpha(a)
 poses[name]=small
 meta[name]={'source':f'source/{name}.png','file':f'sprites-48/{name}.png',
  'size':[48,48],'pivot':[24,24],'headSpanTarget':24,
  'sourceHeadSpan':head_span,'sourceFaceCenterX':face_x,
  'scale':scale,'alphaBounds':list(a.getbbox())}
# One palette for every pose, no dithering or interpolation.
colors=[p[:3] for im in poses.values() for p in im.getdata() if p[3]]
palette_image=Image.new('RGB',(len(colors),1));palette_image.putdata(colors)
palette=palette_image.quantize(colors=32,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
for name,im in poses.items():
 alpha=im.getchannel('A')
 rgb=im.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGB')
 final=rgb.convert('RGBA');final.putalpha(alpha)
 final.putdata([p if p[3] else (0,0,0,0) for p in final.getdata()])
 final.save(ROOT/'sprites-48'/f'{name}.png')
 final.resize((384,384),Image.Resampling.NEAREST).save(ROOT/'previews'/f'{name}-8x.png')
 poses[name]=final
 assert final.size==(48,48) and set(final.getchannel('A').getdata())=={0,255}
 assert all(p[3]==0 for x in range(48) for p in [final.getpixel((x,0)),final.getpixel((x,47)),final.getpixel((0,x)),final.getpixel((47,x))])
FONT='/System/Library/Fonts/Menlo.ttc'
font=ImageFont.truetype(FONT,14)
smallfont=ImageFont.truetype(FONT,12)
comparison=Image.new('RGB',(1280,540),'#10191c');d=ImageDraw.Draw(comparison)
d.text((22,16),'PLAYER / VISUAL PROTOTYPE v1',font=font,fill='#fff3dc')
d.text((22,40),'4 individual poses - 48 x 48 source cells - no FX',font=smallfont,fill='#b6b7ac')
for i,(name,im) in enumerate(poses.items()):
 x=i*320
 d.text((x+12,76),name.upper(),font=smallfont,fill='#fff3dc')
 # Checkerboard is preview-only. Transparent PNGs themselves contain no checker.
 for cy in range(8):
  for cx in range(8):
   d.rectangle((x+16+cx*36,108+cy*36,x+51+cx*36,143+cy*36),fill=('#263238' if (cx+cy)%2 else '#1b252a'))
 big=im.resize((288,288),Image.Resampling.NEAREST)
 comparison.paste(big,(x+16,108),big)
 d.text((x+16,414),'6x / nearest neighbour',font=smallfont,fill='#b6b7ac')
 comparison.paste(im,(x+40,452),im)
 d.text((x+106,470),'1x / 48 px',font=smallfont,fill='#fff3dc')
comparison.save(ROOT/'previews'/'comparison.png')
(ROOT/'manifest.json').write_text(json.dumps({'version':'visual-prototype-v1','paletteColors':32,'alpha':'binary 0/255','origin':[0.5,0.5],'integrated':False,'poses':meta},indent=2))
print(json.dumps(meta,indent=2))
