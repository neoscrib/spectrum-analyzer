/* Browser streaming adapter, 2026-11-19. See vendored UPSTREAM files. */
#include <complex.h>
#include <math.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "demod.h"
#include "decode.h"
#include "channel.h"
#include "parser/mcu_parser.h"
#include "parser/mpdu_parser.h"
#include "utils.h"
#include "correlator/correlator.h"
#include "ecc/viterbi.h"
#include "ecc/descramble.h"
#include "ecc/rs.h"

#define FIFO_SIZE 262144
static int8_t fifo[FIFO_SIZE];
static int used, rd, oqpsk, rate, sr, source_nrzm, source_interleaved;
static Channel channels[6];
static int frames, badframes, packets, jpeg_errors, strips, last_rs, corrected;
static double mixer_phase, mixer_hz;
static float dc_i, dc_q;
static int decimation, decim_count, taps;
static float fir[257], hist_i[257], hist_q[257];
static int hist_pos;
static float constellation[512];
static int const_pos;
static int modern, modern_vit;
static uint64_t input_samples,last_good_sample,last_reset_sample,reacquire_samples;
static int reacquisitions;
static float carrier_limit=.7f;
static int initialized;
/* Optional pre-demodulation baseband tap, bounded by the adapter feed limit. */
static float *bias_iq;
static int bias_count;
void browser_bias_enable(int enabled) {
  if(enabled && !bias_iq) bias_iq=malloc(65536*2*sizeof(float));
  if(!enabled && bias_iq) {free(bias_iq);bias_iq=NULL;}
  bias_count=0;
}
float *browser_bias_iq(void) {return bias_iq;}
int browser_bias_count(void) {return bias_count;}
int browser_bias_rate(void) {return sr/decimation;}
void browser_bias_tune(double hz,int preserve) {
  double delta=hz-mixer_hz;
  mixer_hz=hz;
  if(preserve) pll_shift_freq(-delta*2*M_PI/rate/(oqpsk?2:1));
  else {
    demod_deinit();demod_init(1,SYM_BW,sr/decimation,rate,5,32,oqpsk,carrier_limit);
    used=rd=0;mpdu_parser_init();if(!modern)decode_init(source_nrzm,source_interleaved);last_reset_sample=input_samples;reacquisitions++;
  }
}
void browser_close(void) {
  if(!initialized) return;
  demod_deinit();
  browser_bias_enable(0);
  for(int n=0;n<6;n++) channel_close(&channels[n]);
  initialized=0;
}
void browser_reacquire_after(double seconds) {reacquire_samples=seconds>0?(uint64_t)(seconds*sr):0;}
void browser_carrier_limit(double hz) {
  if(hz<=0)return;
  carrier_limit=hz*2*M_PI/rate;
  demod_deinit();demod_init(1,SYM_BW,sr/decimation,rate,5,32,oqpsk,carrier_limit);
}

int browser_available(void) { return used-rd; }
static uint8_t last_cadu[1024];
uint8_t *browser_last_cadu(void) {return last_cadu;}
void browser_frame(int errors, const void *cadu) {
  last_rs=errors;
  if(errors<0) badframes++; else { frames++; corrected+=errors; last_good_sample=input_samples; memcpy(last_cadu,cadu,1024); }
}
static int read_soft(int8_t *dst, size_t len) {
  if ((int)len>used-rd) return 0;
  memcpy(dst,fifo+rd,len); rd+=len; return 1;
}
static void process_packet(Mpdu *mpdu) {
  packets++;
  int apid=mpdu_apid(mpdu), len=mpdu_len(mpdu);
  if(apid<64||apid>69||len<15||len>(int)sizeof(mpdu->data)) return;
  AVHRR *a=&mpdu->data.mcu.avhrr;
  if(a->seq>=MCU_PER_LINE||avhrr_q(a)<1||avhrr_q(a)>100) { jpeg_errors++; return; }
  uint8_t strip[MCU_PER_MPDU][8][8];
  if(avhrr_decode(strip,a,len-14)) { jpeg_errors++; return; }
  Channel *ch=&channels[apid-64];
  if(ch->offset>=1568*12000) return;
  channel_append_strip(ch,strip,a->seq,mpdu_seq(mpdu)); strips++;
}
static void modern_pending(void) {
  static Mpdu mpdu;
  /* NRZ-M can make each frame's encoded ASM appear inverted. Decode each
   * correlated frame with a consistent rotation INCLUDING its lookahead.
   * A continuous Viterbi across independently rotated frames corrupts tails. */
  while(used-rd>=2*CADU_SOFT_LEN+16*VITERBI_DELAY) {
    uint8_t hard[CONV_CADU_LEN],dummy[VITERBI_DELAY];
    int8_t soft[CADU_SOFT_LEN+16*VITERBI_DELAY];
    enum phase rotation;
    soft_to_hard(hard,fifo+rd,CADU_SOFT_LEN);
    int offset=correlate(&rotation,hard,CONV_CADU_LEN);
    memcpy(soft,fifo+rd+offset,sizeof(soft));
    soft_derotate(soft,sizeof(soft),rotation);
    viterbi_init();
    viterbi_decode(dummy,soft,VITERBI_DELAY);
    Cadu cadu;
    modern_vit=viterbi_decode((uint8_t*)&cadu,soft+16*VITERBI_DELAY,sizeof(cadu))/sizeof(cadu);
    uint8_t *raw=(uint8_t*)&cadu;int prev=0;
    for(unsigned n=0;n<sizeof(cadu);n++) {
      int value=raw[n],out=0;
      for(int b=7;b>=0;b--){int bit=(value>>b)&1;out=(out<<1)|(bit^prev);prev=bit;}
      raw[n]=out;
    }
    descramble(&cadu);
    int errors=rs_fix(&cadu.data);
    if((raw[0]&0x7f)!=0x1a||raw[1]!=0xcf||raw[2]!=0xfc||raw[3]!=0x1d) errors=-1;
    browser_frame(errors,&cadu);
    if(errors>=0){
      for(int n=0;n<512;n++) {ParserStatus st=mpdu_reconstruct(&mpdu,&cadu.data);if(st==PARSED)process_packet(&mpdu);if(st==PROCEED)break;}
    }else mpdu_parser_init();
    rd+=offset+CADU_SOFT_LEN;
  }
}
static void decode_pending(void) {
  static Mpdu mpdu;
  if(modern) modern_pending();
  else {
    DecoderState st;
    while ((st=decode_soft_cadu(&mpdu,read_soft))!=EOF_REACHED) {
      if(st==MPDU_READY)process_packet(&mpdu);
    }
  }
  if(rd) { memmove(fifo,fifo+rd,used-rd); used-=rd; rd=0; }
}
void browser_init(int sample_rate,int symbol_rate,int is_oqpsk,int nrzm,int interleaved) {
  source_nrzm=nrzm;source_interleaved=interleaved;
  sr=sample_rate; rate=symbol_rate; oqpsk=is_oqpsk; modern=nrzm&&!interleaved;
  input_samples=last_good_sample=last_reset_sample=reacquire_samples=0;reacquisitions=0;
  carrier_limit=.7f;
  used=rd=frames=badframes=packets=jpeg_errors=strips=corrected=0; last_rs=-1;
  for(int n=0;n<6;n++) channel_init(&channels[n],n+64);
  /* Keep a 3+ samples/symbol front end. Windowed sinc avoids aliasing on USB decimation. */
  decimation=sr>=600000 ? sr/240000 : 1;
  if(decimation<1) decimation=1;
  taps=decimation==1?1:decimation*16+1;
  if(taps>257) taps=257;
  double sum=0, cutoff=95000.0/sr;
  for(int n=0;n<taps;n++) {
    double x=n-(taps-1)/2.0;
    double v=x==0?2*cutoff:sin(2*M_PI*cutoff*x)/(M_PI*x);
    v*=0.42-0.5*cos(2*M_PI*n/(taps-1))+0.08*cos(4*M_PI*n/(taps-1));
    if(taps==1) v=1;
    fir[n]=v; sum+=v;
  }
  for(int n=0;n<taps;n++) fir[n]/=sum;
  demod_init(1,SYM_BW,sr/decimation,rate,5,32,oqpsk,0.7);
  decode_init(nrzm,interleaved);
  initialized=1;
}
/* Direct soft-symbol input is used by independent FEC/NRZ-M regression tests. */
void browser_feed_soft(int8_t *soft,int count) {
 if(count<0||count>65536||used+count>FIFO_SIZE)return;
 memcpy(fifo+used,soft,count);used+=count;decode_pending();
}
void browser_tune(double hz) { mixer_hz=hz; }
void browser_feed(float *iq,int count) {
  bias_count=0;
  input_samples+=count;
  double step=-2*M_PI*mixer_hz/sr;
  for(int n=0;n<count;n++) {
    float re=iq[2*n]*1024, im=iq[2*n+1]*1024;
    dc_i+=0.00001f*(re-dc_i); dc_q+=0.00001f*(im-dc_q); re-=dc_i; im-=dc_q;
    if(mixer_hz!=0) {
      double c=cos(mixer_phase),s=sin(mixer_phase);
      float tmp=re*c-im*s; im=re*s+im*c; re=tmp;
      mixer_phase+=step;
      if(mixer_phase>M_PI) mixer_phase-=2*M_PI;
      if(mixer_phase<-M_PI) mixer_phase+=2*M_PI;
    }
    if(decimation>1) {
      hist_i[hist_pos]=re; hist_q[hist_pos]=im;
      if(++decim_count<decimation) { hist_pos=(hist_pos+1)%taps; continue; }
      decim_count=0; re=im=0;
      for(int k=0,p=hist_pos;k<taps;k++) {re+=fir[k]*hist_i[p];im+=fir[k]*hist_q[p];if(--p<0)p=taps-1;}
      hist_pos=(hist_pos+1)%taps;
    }
    if(bias_iq && bias_count<65536) {
      bias_iq[2*bias_count]=re/1024; bias_iq[2*bias_count+1]=im/1024; bias_count++;
    }
    float complex sample=re+I*im;
    int ready=oqpsk?demod_oqpsk(&sample):demod_qpsk(&sample);
    if(ready) {
      float x=crealf(sample),y=cimagf(sample);
      constellation[const_pos++%512]=x; constellation[const_pos++%512]=y;
      if(used+2>=FIFO_SIZE) decode_pending();
      fifo[used++]=(int8_t)fmaxf(-127,fminf(127,x/2));
      fifo[used++]=(int8_t)fmaxf(-127,fminf(127,y/2));
    }
  }
  decode_pending();
  /* Retry timing/carrier acquisition during startup or following an outage.
   * NCO phase, RF samples, products and counters survive.
   * Invalid/incomplete soft symbols are discarded; missing imagery stays black. */
  uint64_t last_attempt=last_good_sample>last_reset_sample?last_good_sample:last_reset_sample;
  if(modern&&reacquire_samples&&input_samples-last_attempt>reacquire_samples){
    demod_deinit();demod_init(1,SYM_BW,sr/decimation,rate,5,32,oqpsk,carrier_limit);
    used=rd=0;mpdu_parser_init();last_reset_sample=input_samples;reacquisitions++;
  }
}
int browser_stat(int id) {
  switch(id) {
    case 0:return frames;case 1:return badframes;case 2:return packets;case 3:return strips;
    case 4:return jpeg_errors;case 5:return last_rs;case 6:return modern?modern_vit:decode_get_vit();
    case 7:return pll_get_locked();case 8:return corrected;case 9:return used;
    case 10:return reacquisitions;
    default:return 0;
  }
}
float browser_carrier(void) {return pll_get_freq()*rate/(2*M_PI)*(oqpsk?2:1);}
uint8_t *browser_pixels(int channel) {return channels[channel].pixels;}
int browser_height(int channel) {int height=channels[channel].offset/(MCU_PER_LINE*8)+(channels[channel].mcu_seq?8:0); return height>12000?12000:height;}
float *browser_constellation(void) {return constellation;}
