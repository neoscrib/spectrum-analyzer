#include <assert.h>
#include "channel.h"
int main(void) {
 Channel ch; channel_init(&ch,64);
 for(unsigned int n=0;n<1000;n++) {
  channel_append_strip(&ch,0,(n%14)*14,(n*16300)%16384);
  assert(ch.offset <= 1568UL*12000);
 }
 assert(ch.len < 1568UL*12256);
 channel_close(&ch);
 return 0;
}
