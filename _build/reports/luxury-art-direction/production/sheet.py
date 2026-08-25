import sys
from PIL import Image
tag=sys.argv[1]; names=sys.argv[2].split(',')
ims=[Image.open(f'{tag}/{n}.png') for n in names]
w,h=ims[0].size; sc=float(sys.argv[3]) if len(sys.argv)>3 else 0.42
tw,th=int(w*sc),int(h*sc); cols=3; rows=(len(ims)+cols-1)//cols
sheet=Image.new('RGB',(cols*tw+(cols+1)*12, rows*th+(rows+1)*12),(0,0,0))
for i,im in enumerate(ims):
    r,c=divmod(i,cols); sheet.paste(im.convert('RGB').resize((tw,th)),(12+c*(tw+12),12+r*(th+12)))
sheet.save(f'{tag}/sheet.png'); print('ok', sheet.size)
