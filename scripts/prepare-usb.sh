#!/usr/bin/env bash
set -euo pipefail
# Chrome cannot detach a kernel TV driver through WebUSB. Only touch matching
# RTL2832/2838 devices, and only when the DVB driver currently owns an interface.
found=0
for device in /sys/bus/usb/devices/*; do
  [[ -r "$device/idVendor" && -r "$device/idProduct" ]] || continue
  [[ "$(< "$device/idVendor")" == 0bda ]] || continue
  product="$(< "$device/idProduct")"
  [[ "$product" == 2832 || "$product" == 2838 ]] || continue
  found=1
  for interface in "$device":*; do
    [[ -L "$interface/driver" ]] || continue
    driver="$(readlink -f "$interface/driver")"
    [[ "${driver##*/}" == dvb_usb_rtl28xxu ]] || continue
    name="${interface##*/}"
    printf 'Temporarily releasing TV interface %s for WebUSB.\n' "$name"
    printf '%s' "$name" | sudo tee "$driver/unbind" >/dev/null
  done
done
if [[ "$found" == 0 ]]; then printf 'No matching RTL2832/2838 dongle is connected.\n' >&2; exit 1; fi
printf 'Close other SDR software, then use Connect receiver in Chrome.\n'
