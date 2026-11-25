#!/usr/bin/env python3
"""Refresh the bundled, public-domain Census county-name snapshot (no runtime API)."""
import csv
import io
import json
import pathlib
import urllib.request
URL = "https://www2.census.gov/geo/docs/reference/codes2020/national_county2020.txt"
rows = csv.DictReader(io.StringIO(urllib.request.urlopen(URL).read().decode()), delimiter="|")
counties = {r["STATEFP"] + r["COUNTYFP"]: r["COUNTYNAME"] for r in rows}
pathlib.Path("src/same/counties.json").write_text(json.dumps(counties, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"Wrote {len(counties)} county/equivalent names from {URL}")
