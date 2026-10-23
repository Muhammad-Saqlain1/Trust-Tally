// Generate first-party install icons with Node built-ins. No image service or dependency.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
function distance(x,y,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-(x1+t*dx),y-(y1+t*dy));}
const segments=[[58,47,123,47],[123,47,137,62],[137,62,137,145],[137,145,72,145],[72,145,57,130],[57,130,57,47],[78,47,78,145],[95,77,116,77],[95,97,116,97],[95,117,110,117]];
for(const size of [192,512]){
  const pixels=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++){const row=y*(size*4+1);for(let x=0;x<size;x++){const u=x/size*192,v=y/size*192;const white=segments.some(segment=>distance(u,v,...segment)<4.5);const i=row+1+x*4;pixels[i]=white?255:211;pixels[i+1]=white?255:47;pixels[i+2]=white?255:47;pixels[i+3]=255;}}
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  await writeFile(new URL(`../public/assets/icon-${size}.png`,import.meta.url),png);
}
console.log('Generated install icons (192px, 512px).');
