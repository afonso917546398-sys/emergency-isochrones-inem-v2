#!/usr/bin/env python3
"""
Regenerate isochrone data for INEM emergency bases in Centro region (Portugal).
Uses OpenRouteService API to generate 30' and 60' emergency isochrones.
Emergency speed factor: 1.3x (2340s = 30min emergency, 4680s = 60min emergency)
"""

import json
import time
import urllib.request
import urllib.error

ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjllZWUxY2ZjM2IzYTQwY2RhZTRjMDA0MTA0MzZkODE3IiwiaCI6Im11cm11cjY0In0="
ORS_BASE = "https://api.openrouteservice.org/v2"
RATE_LIMIT_SLEEP = 12  # seconds between requests (free tier limit)
MAX_RETRIES = 4

# Emergency time in seconds (normal driving × 1/1.3 = faster)
# To get 30min emergency → 30 × 60 × 1.3 = 2340s normal driving
# ORS free tier max is 3600s → use 3600s for the ">30'" band (≈46min emergency)
ISO_30 = 2340
ISO_60 = 3600  # ORS free tier max (≈46min emergency driving)

# AEM bases (key: aem_codu_centro, names start with AE)
AEM_BASES = [
    {"name": "AEANADIA",   "lat": 40.4412809, "lon": -8.442222},
    {"name": "AEAVEIRO",   "lat": 40.6338069, "lon": -8.6547181},
    {"name": "AECBR1",     "lat": 40.2285061, "lon": -8.4375933},
    {"name": "AECBR3",     "lat": 40.2285061, "lon": -8.4375933},
    {"name": "AECBR2",     "lat": 40.195982,  "lon": -8.4582927},
    {"name": "AEFIGFOZ",   "lat": 40.1319897, "lon": -8.860647},
    {"name": "AEFUNDAO",   "lat": 40.1352323, "lon": -7.5021134},
    {"name": "AELEIRIA",   "lat": 39.7306759, "lon": -8.8393982},
    {"name": "AEVISEU1",   "lat": 40.6501484, "lon": -7.9080348},
    {"name": "AEVISEU2",   "lat": 40.6480338, "lon": -7.9216632},
    {"name": "AEVISEU3",   "lat": 40.6480338, "lon": -7.9216632},
    {"name": "AEMCOVILHA", "lat": 40.265857,  "lon": -7.491197},
]

# SIV bases (key: aem_codu_centro, names start with SI)
SIV_BASES = [
    {"name": "SIAGUEDA",  "lat": 40.575704,  "lon": -8.4487998},
    {"name": "SIALCOBC",  "lat": 39.5511084, "lon": -8.9726016},
    {"name": "SIARGANIL", "lat": 40.2161518, "lon": -8.0544777},
    {"name": "SIAVELAR",  "lat": 39.9256117, "lon": -8.3561991},
    {"name": "SICANTND",  "lat": 40.341572,  "lon": -8.5892402},
    {"name": "SIPENICH",  "lat": 39.3639495, "lon": -9.3832512},
    {"name": "SIPOMBAL",  "lat": 39.9177619, "lon": -8.625401},
    {"name": "SISEIA",    "lat": 40.4206903, "lon": -7.6964126},
    {"name": "SISPSUL",   "lat": 40.7592891, "lon": -8.061466},
    {"name": "SITONDLA",  "lat": 40.5169105, "lon": -8.0836386},
    {"name": "SIOZEMS",   "lat": 40.8413128, "lon": -8.4715233},
    {"name": "SILAMEGO",  "lat": 41.0829336, "lon": -7.7958781},
    {"name": "SIMOIMEN",  "lat": 40.9723162, "lon": -7.6116592},
    {"name": "SIVNFCOA",  "lat": 41.0793417, "lon": -7.1410983},
    {"name": "SITOMAR",   "lat": 39.6101124, "lon": -8.3954309},
    {"name": "SITNOVAS",  "lat": 39.4684184, "lon": -8.5360985},
    {"name": "SIMIRA",    "lat": 40.4280957, "lon": -8.7414566},
]

# VMER bases + HIDRC (key: vmer_drc, names start with VM or HIDRC)
VMER_BASES = [
    {"name": "VMAVEIRO",  "lat": 40.6337675, "lon": -8.6547601},
    {"name": "VMCRAINH",  "lat": 39.4044611, "lon": -9.1313001},
    {"name": "VMCBRANC",  "lat": 39.8231947, "lon": -7.4999991},
    {"name": "VMCHC",     "lat": 40.1954783, "lon": -8.4609123},
    {"name": "VMFIGFOZ",  "lat": 40.1310663, "lon": -8.860584},
    {"name": "VMCOVILHA", "lat": 40.2655416, "lon": -7.4920001},
    {"name": "VMGUARDA",  "lat": 40.5302503, "lon": -7.2752246},
    {"name": "VMLEIRIA",  "lat": 39.7438981, "lon": -8.7958677},
    {"name": "VMVISEU",   "lat": 40.6503941, "lon": -7.9044977},
    {"name": "VMHUC",     "lat": 40.220454,  "lon": -8.4129141},
    {"name": "VMFEIRA",   "lat": 40.9298746, "lon": -8.5484455},
    {"name": "VMMTJ",     "lat": 39.4554132, "lon": -8.1986675},
    {"name": "VMTVDRS",   "lat": 39.0865746, "lon": -9.256765},
    {"name": "HIDRC",     "lat": 40.7227286, "lon": -7.8892353},
]

# Hospitals (no isochrones, only coordinates)
HOSPITALS = [
    {"name": "CHUC (Coimbra)",          "lat": 40.2183343, "lon": -8.4135048, "type": "SUP"},
    {"name": "H. Aveiro (CHBV)",        "lat": 40.6336646, "lon": -8.6550745, "type": "SUMC"},
    {"name": "H. Feira (CHEDV)",        "lat": 40.9298779, "lon": -8.5467557, "type": "SUMC"},
    {"name": "H. Caldas da Rainha",     "lat": 39.4049728, "lon": -9.1298513, "type": "SUMC"},
    {"name": "H. Abrantes (CHMT)",      "lat": 39.4560645, "lon": -8.1992725, "type": "SUMC"},
    {"name": "H. Castelo Branco",       "lat": 39.8223229, "lon": -7.4998672, "type": "SUMC"},
    {"name": "H. Covilhã (CHCB)",       "lat": 40.2665918, "lon": -7.4920883, "type": "SUMC"},
    {"name": "H. Viseu (S. Teotónio)",  "lat": 40.6513045, "lon": -7.9045563, "type": "SUP"},
    {"name": "H. Leiria (S. André)",    "lat": 39.7428605, "lon": -8.7939098, "type": "SUMC"},
    {"name": "H. Figueira da Foz",      "lat": 40.1303741, "lon": -8.8613742, "type": "SUMC"},
    {"name": "SUB Águeda",              "lat": 40.5756521, "lon": -8.4487333, "type": "SUB"},
    {"name": "SUB Arganil",             "lat": 40.2157026, "lon": -8.0545511, "type": "SUB"},
    {"name": "SUB Pombal",              "lat": 39.917176,  "lon": -8.6249076, "type": "SUB"},
    {"name": "SUB Alcobaça",            "lat": 39.5505561, "lon": -8.9727965, "type": "SUB"},
    {"name": "SUB Seia",                "lat": 40.4210138, "lon": -7.6961048, "type": "SUB"},
    {"name": "SUB Peniche",             "lat": 39.3634714, "lon": -9.3829049, "type": "SUB"},
    {"name": "SUB S. Pedro Sul",        "lat": 40.7597721, "lon": -8.0615113, "type": "SUB"},
    {"name": "SUB Tondela",             "lat": 40.516904,  "lon": -8.0828821, "type": "SUB"},
]


def fetch_isochrone(lon, lat, ranges, attempt=0):
    """Fetch isochrone polygon from ORS for given location and time ranges (seconds)."""
    url = f"{ORS_BASE}/isochrones/driving-car"
    payload = json.dumps({
        "locations": [[lon, lat]],
        "range": ranges,
        "range_type": "time",
        "smoothing": 0.5,
        "area_units": "km",
        "units": "km"
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": ORS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json, application/geo+json"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429 and attempt < MAX_RETRIES:
            wait = 30 * (attempt + 1)
            print(f"\n    [429] Rate limit, waiting {wait}s (retry {attempt+1}/{MAX_RETRIES})...", end=" ", flush=True)
            time.sleep(wait)
            return fetch_isochrone(lon, lat, ranges, attempt + 1)
        raise


def process_bases(bases, group_name):
    """Process a list of bases and return list with isochrone data."""
    results = []
    total = len(bases)

    for i, base in enumerate(bases):
        name = base["name"]
        lat = base["lat"]
        lon = base["lon"]
        print(f"  [{i+1}/{total}] {name} ({lat}, {lon})...", end=" ", flush=True)

        try:
            data = fetch_isochrone(lon, lat, [ISO_30, ISO_60])
            features = data.get("features", [])

            iso_30 = None
            iso_60 = None

            for feat in features:
                val = feat.get("properties", {}).get("value", 0)
                if val == ISO_30:
                    iso_30 = feat
                elif val == ISO_60:
                    iso_60 = feat

            entry = {
                "name": name,
                "lat": lat,
                "lon": lon,
                "isochrones": {}
            }
            if iso_30:
                entry["isochrones"]["30"] = iso_30
            if iso_60:
                entry["isochrones"]["60"] = iso_60

            results.append(entry)
            print("OK")

        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            print(f"HTTP ERROR {e.code}: {body[:200]}")
            results.append({
                "name": name,
                "lat": lat,
                "lon": lon,
                "isochrones": {},
                "error": f"HTTP {e.code}"
            })
        except Exception as ex:
            print(f"ERROR: {ex}")
            results.append({
                "name": name,
                "lat": lat,
                "lon": lon,
                "isochrones": {},
                "error": str(ex)
            })

        if i < total - 1:
            time.sleep(RATE_LIMIT_SLEEP)

    return results


def main():
    print("=== INEM Isochrones Generator ===")
    print(f"ORS endpoint: {ORS_BASE}")
    print(f"30' range: {ISO_30}s | 60' range: {ISO_60}s")
    print()

    result = {}

    # --- aem_codu_centro: AEM + SIV combined ---
    print(f"Processing AEM bases ({len(AEM_BASES)} total)...")
    aem_results = process_bases(AEM_BASES, "aem_codu_centro")
    print()

    print(f"Processing SIV bases ({len(SIV_BASES)} total)...")
    time.sleep(RATE_LIMIT_SLEEP)
    siv_results = process_bases(SIV_BASES, "aem_codu_centro")
    print()

    result["aem_codu_centro"] = aem_results + siv_results

    # --- vmer_drc: VMER + HIDRC ---
    print(f"Processing VMER+HIDRC bases ({len(VMER_BASES)} total)...")
    time.sleep(RATE_LIMIT_SLEEP)
    vmer_results = process_bases(VMER_BASES, "vmer_drc")
    print()

    result["vmer_drc"] = vmer_results

    # --- hospitais: no isochrones ---
    result["hospitais"] = HOSPITALS

    # Write data.js
    js_content = "const ISOCHRONE_DATA = " + json.dumps(result, ensure_ascii=False, separators=(',', ':')) + ";\n"

    with open("data.js", "w", encoding="utf-8") as f:
        f.write(js_content)

    total_bases = len(aem_results) + len(siv_results) + len(vmer_results)
    errors = sum(1 for g in [aem_results, siv_results, vmer_results] for b in g if "error" in b)

    print(f"=== DONE ===")
    print(f"Total bases processed: {total_bases}")
    print(f"Errors: {errors}")
    print(f"data.js written ({len(js_content)//1024} KB)")


if __name__ == "__main__":
    main()
