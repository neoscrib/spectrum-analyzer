/* SPDX-License-Identifier: GPL-2.0-or-later
 * Spectrum's embedding adapter for unmodified rtl_433 25.12 acquisition DSP.
 * Include the CLI TU to reuse its streaming callback, without exporting main.
 */
#include <emscripten.h>
#define main spectrum_unused_cli_main
#include "rtl_433.c"
#undef main
static r_cfg_t *receiver;
static unsigned messages;
static unsigned truncated;
static char text[65536];
static char catalog[65536];
EM_JS(void, spectrum_message, (const char *value), {
    if (Module.onDecoded) Module.onDecoded(UTF8ToString(value));
});
static void output_print(data_output_t *output, data_t *data) {
    (void)output;
    size_t used = data_print_jsons(data, text, sizeof(text));
    if (used >= sizeof(text)-1) { truncated++; return; }
    messages++;
    spectrum_message(text);
}
static void output_free(data_output_t *output) { free(output); }
EMSCRIPTEN_KEEPALIVE void rtl_free(void) {
    if (!receiver) return;
    r_free_cfg(receiver); free(receiver); receiver = NULL;
}
/* selection: -1=defaults, 0=all visible, positive protocol number=one */
EMSCRIPTEN_KEEPALIVE int rtl_init(int selection, double frequency, double level) {
    rtl_free();
    receiver = r_create_cfg(); messages = 0; truncated = 0;
    receiver->samp_rate = 240000;
    receiver->frequency[0] = receiver->center_frequency = (uint32_t)frequency;
    receiver->frequencies = 1;
    receiver->report_time = REPORT_TIME_SAMPLES;
    receiver->report_protocol = 1;
    receiver->report_description = 1;
    receiver->report_meta = 1;
    receiver->verbosity = LOG_ERROR;
    receiver->demod->sample_size = 4; /* native CS16, preserves filtered precision */
    receiver->demod->use_mag_est = 1;
    receiver->demod->auto_level = level == 0;
    receiver->demod->min_level = -60;
    receiver->demod->level_limit = (float)level;
    pulse_detect_set_levels(receiver->demod->pulse_detect, 1, level, -60, 9, LOG_ERROR);
    data_output_t *output = calloc(1, sizeof(*output));
    output->output_print = output_print; output->output_free = output_free;
    output->log_level = LOG_ERROR;
    list_push(&receiver->output_handler, output);
    if (selection <= 0) register_all_protocols(receiver, selection == 0 ? 1 : 0);
    else if (selection <= receiver->num_r_devices && receiver->devices[selection-1].disabled <= 1)
        register_protocol(receiver, &receiver->devices[selection-1], NULL);
    if (!receiver->demod->r_devs.len) { rtl_free(); return 0; }
    for (void **p=receiver->demod->r_devs.elems; p && *p; p++)
        if (((r_device *)*p)->modulation >= FSK_DEMOD_MIN_VAL) receiver->demod->enable_FM_demod=1;
    /* Produce catalog from the compiled registry, not a separately maintained list. */
    size_t pos=0; catalog[pos++]='[';
    for (unsigned i=0;i<receiver->num_r_devices;i++) {
        r_device *device=&receiver->devices[i];
        if (device->disabled>1) continue;
        data_t *entry=data_make("id","",DATA_INT,device->protocol_num,
            "name","",DATA_STRING,device->name,
            "disabled","",DATA_INT,device->disabled,NULL);
        char json[1024]; data_print_jsons(entry,json,sizeof(json)); data_free(entry);
        size_t n=strlen(json);
        if (pos+n+3 >= sizeof(catalog)) break;
        if (pos>1) catalog[pos++]=',';
        memcpy(catalog+pos,json,n);pos+=n;
    }
    catalog[pos++]=']';catalog[pos]=0;
    return (int)receiver->demod->r_devs.len;
}
EMSCRIPTEN_KEEPALIVE int rtl_process(uint8_t *data, int bytes) {
    if (!receiver || bytes<=0 || bytes%4 || bytes>65536*4) return 0;
    receiver->demod->sample_file_pos=(double)(receiver->input_pos+bytes/4)/receiver->samp_rate;
    sdr_callback(data,(uint32_t)bytes,receiver);
    return 1;
}
EMSCRIPTEN_KEEPALIVE const char *rtl_protocols(void) { return catalog; }
EMSCRIPTEN_KEEPALIVE const char *rtl_stats(void) {
    if (!receiver) return "{}";
    snprintf(text,sizeof(text),"{\"enabled\":%u,\"ook\":%u,\"fsk\":%u,\"messages\":%u,\"truncated\":%u}",
      (unsigned)receiver->demod->r_devs.len,receiver->total_frames_ook,receiver->total_frames_fsk,messages,truncated);
    return text;
}
