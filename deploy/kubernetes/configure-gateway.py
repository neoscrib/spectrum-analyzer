#!/usr/bin/env python3
"""Add Spectrum's listener without taking ownership of the shared Gateway."""

import argparse
import json
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--dry-run", action="store_true", help="print the proposed JSON patch")
args = parser.parse_args()

resource = ["gateway", "myapps-gateway", "-n", "myapps"]
gateway = json.loads(subprocess.check_output(["kubectl", "get", *resource, "-o", "json"]))
listener = {
    "name": "spectrumsdr-https",
    "hostname": "spectrumsdr.com",
    "port": 8443,
    "protocol": "HTTPS",
    "allowedRoutes": {"namespaces": {"from": "Same"}},
    "tls": {
        "mode": "Terminate",
        "certificateRefs": [{"group": "", "kind": "Secret", "name": "spectrumsdr-cert"}],
    },
}
listeners = gateway["spec"]["listeners"]
existing = next((item for item in listeners if item["name"] == listener["name"]), None)
if existing is not None:
    if existing != listener:
        raise SystemExit("The Spectrum listener already exists with different settings; review it before changing it.")
    print("Spectrum Gateway listener is already configured.")
else:
    patch = [
        {"op": "test", "path": "/metadata/resourceVersion", "value": gateway["metadata"]["resourceVersion"]},
        {"op": "add", "path": "/spec/listeners/-", "value": listener},
    ]
    if args.dry_run:
        print(json.dumps(patch, indent=2))
    else:
        subprocess.run(["kubectl", "patch", *resource, "--type=json", "-p", json.dumps(patch)], check=True)
