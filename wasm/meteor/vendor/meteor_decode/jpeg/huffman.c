#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "huffman.h"
#include "utils.h"

#define EOB 0x00

static int get_dc_cat(uint16_t codeword);

static const uint8_t _dc_prefix_size[12] = {2, 3, 3, 3, 3, 3, 4, 5, 6, 7, 8, 9};
static const uint8_t _ac_table_size[17] = {0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125};
static const uint8_t _ac_table[] =
{
	1, 2,
	3,
	0, 4, 17,
	5, 18, 33,
	49, 65,
	6, 19, 81, 97,
	7, 34, 113,
	20, 50, 129, 145, 161,
	8, 35, 66, 177, 193,
	21, 82, 209, 240,
	36, 51, 98, 114,
	130,
	9, 10, 22, 23, 24, 25, 26, 37, 38, 39, 40, 41, 42, 52, 53, 54, 55, 56, 57,
	58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86, 87, 88, 89, 90, 99, 100,
	101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122, 131,
	132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153,
	154, 162, 163, 164, 165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182,
	183, 184, 185, 186, 194, 195, 196, 197, 198, 199, 200, 201, 202, 210, 211,
	212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228, 229, 230, 231, 232,
	233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250
};

/* Bounded bit reader: reject truncated/invalid strips instead of displaying
 * uninitialized pixels. Added for browser streaming, 2026-11-19. */
static unsigned peek(const uint8_t *src, int length, int pos, int count) {
 unsigned out=0;
 for(int b=0;b<count;b++) {int at=pos+b;out=(out<<1)|((at<length*8)?((src[at/8]>>(7-at%8))&1):0);}
 return out;
}
int
huffman_decode(int16_t (*dst)[8][8], const uint8_t *src, int count, int maxlen)
{
 int pos=0,dc=0;
 memset(dst,0,count*64*sizeof(int16_t));
 for(int block=0;block<count;block++) {
  int category=get_dc_cat(peek(src,maxlen,pos,16));
  if(category<0) return 1;
  pos+=_dc_prefix_size[category];
  if(pos+category>maxlen*8)return 1;
  int value=peek(src,maxlen,pos,category);pos+=category;
  if(category&&value<(1<<(category-1)))value-= (1<<category)-1;
  dc+=value;dst[block][0][0]=dc;
  for(int r=1;r<64;) {
   unsigned code=0,first=0,index=0,symbol=0;int found=0;
   for(int bits=1;bits<=16;bits++) {
    if(pos>=maxlen*8)return 1;
    code=(code<<1)|peek(src,maxlen,pos++,1);
    if(code>=first&&code-first<_ac_table_size[bits]) {symbol=_ac_table[index+code-first];found=1;break;}
    index+=_ac_table_size[bits];first=(first+_ac_table_size[bits])<<1;
   }
   if(!found)return 1;
   if(symbol==0)break;
   int run=symbol>>4,size=symbol&15;
   if(size==0){if(run!=15||r+16>64)return 1;r+=16;continue;}
   r+=run;
   if(r>=64||pos+size>maxlen*8)return 1;
   int ac=peek(src,maxlen,pos,size);pos+=size;
   if(ac<(1<<(size-1)))ac-=(1<<size)-1;
   dst[block][r/8][r%8]=ac;r++;
  }
 }
 return 0;
}

/* Static functions {{{ */
static int
get_dc_cat(uint16_t codeword)
{
	if (codeword >> 14 == 0) return 0;
	if (codeword >> 13 < 7) return (codeword >> 13) - 1;
	if (codeword >> 12 < 0xF) return 6;
	if (codeword >> 11 < 0x1F) return 7;
	if (codeword >> 10 < 0x3F) return 8;
	if (codeword >> 9 < 0x7F) return 9;
	if (codeword >> 8 < 0xFF) return 10;
	if (codeword >> 7 < 0x1FF) return 11;
	return -1;
}
/* }}} */
