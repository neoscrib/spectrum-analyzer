// Spectrum ADS-B WASM adapter. SPDX-License-Identifier: GPL-2.0-or-later
// Links the pinned dump1090-fa demodulator/Mode S/CPR core, with no SDR, network,
// threads, tracking service or filesystem. See public/licenses/dump1090-NOTICE.txt.
#include "dump1090.h"
#include <stdarg.h>

#define OVERLAP 320
#define BLOCK 65536
#define OUTPUT 262144
struct _Modes Modes;
uint64_t _messageNow;
static uint16_t magnitude[BLOCK + OVERLAP], lut[65536];
static unsigned retained, discontinuous = 1, emitted, dropped;
static uint64_t origin, expected, samples, gaps, valid, corrected;
static char output[OUTPUT], stats[1024], cpr_result[128];
static size_t used;
static double noise;
uint64_t mstime(void) { return samples / 2400; }
int64_t receiveclock_ms_elapsed(uint64_t a, uint64_t b) { return ((int64_t)b - (int64_t)a) / 12000; }
void adaptive_update(uint16_t *buf, unsigned length, struct modesMessage *decoded) { (void)buf; (void)length; (void)decoded; }
// These unreachable upstream CLI/display hooks are discarded by LTO.
struct aircraft *trackUpdateFromMessage(struct modesMessage *mm) { (void)mm; return NULL; }
void modesQueueOutput(struct modesMessage *mm, struct aircraft *a) { (void)mm; (void)a; }
static void append(const char *fmt, ...) {
    va_list args;
    va_start(args,fmt);
    int n = vsnprintf(output + used, OUTPUT - used,fmt,args);
    va_end(args);
    if (n > 0 && (size_t)n < OUTPUT - used) used += n;
}
void adsb_message(struct modesMessage *m) {
    // Never acquire an aircraft from a corrected guess. AP formats also require
    // upstream's recently verified address cache; nonzero DF11 IID is not CRC=0.
    if (m->correctedbits && !icaoFilterTest(m->addr | (m->msgtype == 18 ? ICAO_FILTER_ADSB_NT : 0))) return;
    valid++; corrected += m->correctedbits != 0;
    if (emitted >= 128 || used > OUTPUT - 4096) { dropped++; return; }
    char hex[29], original[29];
    for (int i=0;i<m->msgbits/8;i++) { sprintf(hex+i*2,"%02X",m->msg[i]); sprintf(original+i*2,"%02X",m->verbatim[i]); }
    append("%s{\"hex\":\"%s\",\"original\":\"%s\",\"df\":%d,\"address\":\"%06X\",\"icao\":%s,\"addressType\":%d,\"source\":%d,\"corrected\":%d,\"syndrome\":%u,\"seconds\":%.9f,\"signal\":%.2f,\"capability\":%u,\"control\":%u,\"typeCode\":%u,\"subtype\":%u,\"airground\":%d",
        emitted?",":"",hex,original,m->msgtype,m->addr & 0xffffff, (m->addr & MODES_NON_ICAO_ADDRESS)?"false":"true",m->addrtype,m->source,m->correctedbits,m->crc,m->timestampMsg/12000000.0,10*log10(fmax(1e-12,m->signalLevel)),m->CA,m->CF,m->metype,m->mesub,m->airground);
#define FIELD(flag,name,format,value) if(m->flag) append(",\"" name "\":" format,value)
    FIELD(altitude_baro_valid,"baroAltitude","%.1f",m->altitude_baro*(m->altitude_baro_unit==UNIT_METERS?3.28084:1));
    FIELD(altitude_geom_valid,"gnssAltitude","%.1f",m->altitude_geom*(m->altitude_geom_unit==UNIT_METERS?3.28084:1));
    FIELD(gs_valid,"groundSpeed","%.2f",m->gs.selected);
    if(m->gs_valid && m->cpr_valid && m->cpr_type==CPR_SURFACE) append(",\"surfaceSpeedV2\":%.2f",m->gs.v2);
    FIELD(ias_valid,"ias","%u",m->ias); FIELD(tas_valid,"tas","%u",m->tas);
    FIELD(heading_valid,"heading","%.2f",m->heading); FIELD(heading_valid,"headingType","%d",m->heading_type);
    FIELD(baro_rate_valid,"baroRate","%d",m->baro_rate); FIELD(geom_rate_valid,"gnssRate","%d",m->geom_rate);
    FIELD(squawk_valid,"squawk","\"%04X\"",m->squawk);
    FIELD(emergency_valid,"emergency","%d",m->emergency);
    FIELD(category_valid,"category","%u",m->category);
    FIELD(callsign_valid,"callsign","\"%.8s\"",m->callsign);
    if(m->cpr_valid) append(",\"cpr\":{\"lat\":%u,\"lon\":%u,\"odd\":%s,\"surface\":%s,\"type\":%d}",m->cpr_lat,m->cpr_lon,m->cpr_odd?"true":"false",m->cpr_type==CPR_SURFACE?"true":"false",m->cpr_type);
    if(m->opstatus.valid) append(",\"version\":%u,\"ident\":%s",m->opstatus.version,m->opstatus.om_ident?"true":"false");
    if(m->accuracy.nac_p_valid) append(",\"nacp\":%u",m->accuracy.nac_p);
    if(m->nav.mcp_altitude_valid) append(",\"selectedAltitude\":%d",m->nav.mcp_altitude);
    if(m->nav.qnh_valid) append(",\"qnh\":%.1f",m->nav.qnh);
    append("}"); emitted++;
}
int adsb_init(int fix) {
    static int initialized;
    if(initialized) return 0;
    initialized = 1;
    memset(&Modes,0,sizeof Modes);
    Modes.nfix_crc = fix ? 1 : 0; Modes.fix_df = 0; Modes.sample_rate=2400000;
    Modes.quiet=1; Modes.check_crc=1;
    modesChecksumInit(fix ? 1 : 0); icaoFilterInit(); modeACInit();
    for(unsigned q=0;q<256;q++) for(unsigned i=0;i<256;i++) lut[(q<<8)|i] = (uint16_t)fmin(65535,sqrt((i-127.5)*(i-127.5)+(q-127.5)*(q-127.5))*363.4533);
    used=1; output[0]='['; return 1;
}
static void demod(void) {
    if(retained<=OVERLAP) return;
    struct mag_buf b={0}; b.data=magnitude; b.validLength=retained; b.totalLength=BLOCK+OVERLAP; b.overlap=OVERLAP;
    b.sampleTimestamp=origin*5; b.sysTimestamp=origin/2400; b.flags=discontinuous ? MAGBUF_DISCONTINUOUS : 0;
    b.mean_power=noise;
    demodulate2400(&b); discontinuous=0;
    unsigned consumed=retained-OVERLAP;
    memmove(magnitude,magnitude+consumed,OVERLAP*sizeof(uint16_t));
    retained=OVERLAP; origin+=consumed;
}
int adsb_process(const uint8_t *iq, unsigned bytes, double first) {
    if(bytes%2 || bytes>BLOCK*2 || !isfinite(first) || first<0) return 0;
    uint64_t at=(uint64_t)first;
    if(samples && at!=expected) { retained=0; discontinuous=1; gaps++; icaoFilterInit(); }
    if(!retained) origin=at;
    double power=0;
    for(unsigned n=0;n<bytes;n+=2) { uint16_t m=lut[(iq[n+1]<<8)|iq[n]]; magnitude[retained++]=m; power+=(double)m*m; }
    if(bytes) noise = .9*noise + .1*(power/(bytes/2)/65535.0/65535.0);
    samples += bytes/2; expected=at+bytes/2;
    icaoFilterExpire(); demod(); return 1;
}
void adsb_finish(void) { if(retained) { memset(magnitude+retained,0,OVERLAP*sizeof(uint16_t)); retained+=OVERLAP; demod(); retained=0; } }
const char *adsb_take(void) { output[used]=']'; output[used+1]=0; used=1; emitted=0; return output; }
const char *adsb_stats(void) {
    snprintf(stats,sizeof stats,"{\"samples\":%llu,\"valid\":%llu,\"corrected\":%llu,\"preambles\":%u,\"rejected\":%u,\"unknownAddress\":%u,\"dropped\":%u,\"discontinuities\":%llu,\"noise\":%.2f}",
        (unsigned long long)samples,(unsigned long long)valid,(unsigned long long)corrected,Modes.stats_current.demod_preambles,Modes.stats_current.demod_rejected_bad,Modes.stats_current.demod_rejected_unknown_icao,dropped,(unsigned long long)gaps,10*log10(fmax(noise,1e-12)));
    return stats;
}
const char *adsb_cpr(int type,double lat,double lon,int elat,int elon,int olat,int olon,int odd,int surface) {
    double outlat,outlon; int result;
    if(type==0) result=decodeCPRairborne(elat,elon,olat,olon,odd,&outlat,&outlon);
    else if(type==1) result=decodeCPRsurface(lat,lon,elat,elon,olat,olon,odd,&outlat,&outlon);
    else result=decodeCPRrelative(lat,lon,elat,elon,odd,surface,&outlat,&outlon);
    if(result) return "null";
    snprintf(cpr_result,sizeof cpr_result,"[%.10f,%.10f]",outlat,outlon); return cpr_result;
}
// Raw-frame entry point for deterministic parser tests; never skips parity validation.
int adsb_frame(const uint8_t *data,int bytes,double seconds) {
    if(bytes!=7 && bytes!=14) return 0;
    unsigned char raw[14]={0}; memcpy(raw,data,bytes);
    if(modesMessageLenByType(raw[0]>>3)!=bytes*8) return 0;
    struct modesMessage m={0}; m.timestampMsg=(uint64_t)(seconds*12000000);
    if(decodeModesMessage(&m,raw)<0) return 0;
    adsb_message(&m); return 1;
}
