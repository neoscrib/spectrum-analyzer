#!/usr/bin/env bash
set -euo pipefail
# Chrome cannot detach a kernel TV driver through WebUSB. Use the same known
# RTL2832U IDs as the chooser, and only release the RTL DVB interface driver.
radio_repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mapfile -t known_ids < <(python3 - "$radio_repo/src/sources/rtl-usb-ids.json" <<'PY'
import json, sys
for vendor, product in json.load(open(sys.argv[1])):
    print(f"{vendor:04x}:{product:04x}")
PY
)
found=0
for device in /sys/bus/usb/devices/*; do
  [[ -r "$device/idVendor" && -r "$device/idProduct" ]] || continue
  usb_id="$(< "$device/idVendor"):$(< "$device/idProduct")"
  match=0
  for known_id in "${known_ids[@]}"; do
    if [[ "$usb_id" == "$known_id" ]]; then match=1; break; fi
  done
  [[ "$match" == 1 ]] || continue
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
if [[ "$found" == 0 ]]; then printf 'No matching RTL2832U dongle is connected.\n' >&2; exit 1; fi
printf 'Close other SDR software, then use Connect receiver in Chrome.\n'
