"""
Standalone test: authenticate against the Datascape API and GET any URL.

This is a throwaway probe — it does NOT touch aegis_apis.py. Paste a full
Datascape API URL into REQUEST_URL below, run the script, and it will:
  1. POST credentials to /connect/token -> Bearer access_token
  2. GET the URL you pasted, with that token attached
  3. Pretty-print the response and save it to scripts/outputs/json/<name>.json

Usage:
  python scripts/python/test_v3_elements.py                   # default name
  python scripts/python/test_v3_elements.py "Arkari_WP_2"     # custom name
  python scripts/python/test_v3_elements.py --th "StationName"  # threshold mode

Pass the file name WITHOUT an extension — it is always saved as .json.

--th (threshold-extraction mode): GETs the station element list from
REQUEST_URL, then for every element GETs /v3/elements/{elementId}, decodes
its entryCfgs into labelled threshold bands, and saves one combined JSON
of thresholds + labels per element. The default mode is left untouched.
"""

import json
import os
import sys
import time

import requests

# Windows consoles default to cp1252, which cannot encode °, ≤, ≥ — force
# UTF-8 so the printed summary doesn't crash (the saved .json is UTF-8 too).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ===========================================================================
# >>> PASTE THE URL YOU WANT TO TEST HERE <<<
# ===========================================================================
REQUEST_URL = (
    "http://115.186.56.181/datascapea/v3/elements"
    "?station_id=975800&longitude&latitude&category=1&ui_culture=en"
    "&field=ElementName&field=Time&field=Value&field=Decimals"
    "&field=MeasUnit&field=Trend&field=StateId&field=IsQueryable"
    "&filter_central_id&filter_id&_=1779337589706"
)
# ===========================================================================

# ---------------------------------------------------------------------------
# Auth config — same credentials/base as aegis_apis.py
# ---------------------------------------------------------------------------
TOKEN_URL = "http://115.186.56.181/datascapea/connect/token"

USERNAME = "DatascapeUser"
PASSWORD = "hQKPv8N27RxWQu3t4DE0"
CLIENT_ID = "GenericClient"
CLIENT_INSTANCE = "12345"

REQUEST_TIMEOUT = 60

# Saved responses go here, resolved relative to this script file so the
# output path is the same no matter what directory you run it from.
OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "outputs", "json"
)
DEFAULT_OUTPUT_NAME = "api_response"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def get_access_token() -> str:
    payload = {
        "username": USERNAME,
        "password": PASSWORD,
        "grant_type": "password",
        "client_id": CLIENT_ID,
        "client_instance": CLIENT_INSTANCE,
    }
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    response = requests.post(TOKEN_URL, data=payload, headers=headers, timeout=30)
    response.raise_for_status()
    data = response.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"No access_token in response: {data}")
    return token


# ===========================================================================
# Threshold-extraction mode (--th)  —  added; does not affect default mode
# ===========================================================================
# thresholdOperator -> comparison symbol. 1/5/6/7 are confirmed from live
# data; 2 (<=) is inferred to complete the standard comparison set.
_OPERATOR_SYMBOL = {1: "<", 2: "≤", 5: "≥", 6: ">", 7: "range"}


def _state_label(state_id):
    """Map a 0-100 alertStateId severity score to a human label.

    stateDescr in the response is unreliable (often null or ""), so the
    label is bucketed from the score instead. Verified against every
    sample seen: 0=Normal, 20=Error, 50/60=Warning, 70/80=Pre-alarm,
    90/100=Alarm.
    """
    if state_id == 0:
        return "Normal"
    if state_id == 20:
        return "Error"
    if 40 <= state_id < 70:
        return "Warning"
    if 70 <= state_id < 90:
        return "Pre-alarm"
    if state_id >= 90:
        return "Alarm"
    return f"State {state_id}"


def _fmt_num(x, decimals):
    if x is None:
        return "null"
    return f"{float(x):.{decimals}f}"


def _condition_text(op, value, max_value, subject, decimals):
    """Render one entry as a human range, e.g. '-50.00 <= value < 11.00'."""
    v = _fmt_num(value, decimals)
    if op == 7:
        return f"{v} ≤ {subject} < {_fmt_num(max_value, decimals)}"
    if op == 1:
        return f"{subject} < {v}"
    if op == 2:
        return f"{subject} ≤ {v}"
    if op == 5:
        return f"{subject} ≥ {v}"
    if op == 6:
        return f"{subject} > {v}"
    return f"{subject} ?op{op} {v}"


def _fmt_trend_period(minutes):
    """60 -> '1h', 180 -> '3h', 30 -> '30m'."""
    if minutes in (None, 0):
        return None
    return f"{minutes // 60}h" if minutes % 60 == 0 else f"{minutes}m"


def parse_entry_cfgs(entry_cfgs, decimals):
    """Decode a raw entryCfgs array into labelled threshold blocks,
    grouped by alarmId (each alarmId = one alarm with its own header)."""
    groups = {}
    for e in entry_cfgs or []:
        groups.setdefault(e.get("alarmId"), []).append(e)

    blocks = []
    for alarm_id, entries in groups.items():
        first = entries[0]
        is_trend = first.get("thresholdType") == 2
        subject = "trend" if is_trend else "value"
        # Keep the API's array order — it is entryId/insertion order, which
        # matches how the Datascape UI panel lists the states.
        states = []
        for e in entries:
            op = e.get("thresholdOperator")
            states.append(
                {
                    # stateDescr first if present, else the score heuristic.
                    "label": e.get("stateDescr")
                    or _state_label(e.get("alertStateId") or 0),
                    "alertStateId": e.get("alertStateId"),
                    "operator": _OPERATOR_SYMBOL.get(op, op),
                    "min": e.get("value"),
                    "max": e.get("maxValue"),
                    "condition": _condition_text(
                        op, e.get("value"), e.get("maxValue"), subject, decimals
                    ),
                }
            )
        blocks.append(
            {
                "alarmId": alarm_id,
                "alarmName": first.get("alarmName"),
                "type": "TREND" if is_trend else "VALUE",
                "trendPeriod": _fmt_trend_period(first.get("trendPeriod"))
                if is_trend
                else None,
                "states": states,
            }
        )
    return blocks


def run_threshold_mode(name: str) -> int:
    """--th mode: for the station in REQUEST_URL, fetch every element's
    /v3/elements/{id} detail, decode its entryCfgs, and save one combined
    JSON of thresholds + labels per element."""
    out_name = os.path.splitext(os.path.basename(name.strip()))[0]
    out_path = os.path.join(OUTPUT_DIR, out_name + ".json")
    detail_base = REQUEST_URL.split("?")[0]  # .../v3/elements

    try:
        print("Requesting access token...")
        token = get_access_token()
        print(f"  Got token ({len(token)} chars).\n")
        headers = {"Accept": "*/*", "Authorization": f"Bearer {token}"}

        # 1. Station element list — each element carries an elementId.
        print(f"GET station element list ...\n  {REQUEST_URL}")
        resp = requests.get(REQUEST_URL, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        elements = resp.json()
        if not isinstance(elements, list) or not elements:
            print("No elements returned for this station.", file=sys.stderr)
            return 1
        print(f"  {len(elements)} element(s).\n")

        station_id = elements[0].get("stationId")
        station_name = elements[0].get("stationName") or out_name

        # 2. Per element: GET /v3/elements/{id} detail -> decode entryCfgs.
        out_elements = []
        for el in elements:
            eid = el.get("elementId")
            detail_url = (
                f"{detail_base}/{eid}?ui_culture=en&_={int(time.time() * 1000)}"
            )
            d = requests.get(detail_url, headers=headers, timeout=REQUEST_TIMEOUT)
            d.raise_for_status()
            detail = d.json()
            decimals = detail.get("decimals")
            if decimals is None:
                decimals = el.get("decimals") or 2
            alarms = parse_entry_cfgs(detail.get("entryCfgs"), decimals)
            out_elements.append(
                {
                    "elementId": eid,
                    "elementName": el.get("elementName"),
                    "measUnit": el.get("measUnit"),
                    "decimals": decimals,
                    "currentValue": el.get("value"),
                    "currentState": el.get("stateDescr"),
                    "alarms": alarms,
                }
            )
            print(f"  {eid}  {el.get('elementName')!r}  -> {len(alarms)} alarm block(s)")
            time.sleep(0.1)

        result = {
            "station": station_name,
            "stationId": station_id,
            "elementCount": len(out_elements),
            "elements": out_elements,
        }

        # 3. Save + readable summary.
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        print(f"\n--- Thresholds: {station_name} ---")
        for el in out_elements:
            print(f"\n{el['elementName']} ({el['measUnit']})  [id {el['elementId']}]")
            if not el["alarms"]:
                print("  (no thresholds configured)")
            for a in el["alarms"]:
                head = a["type"] + (f" ({a['trendPeriod']})" if a["trendPeriod"] else "")
                print(f"  {a['alarmName']}  [{head}]")
                for s in a["states"]:
                    print(f"    {s['label']:<10} {s['condition']}")

        print(f"\nSaved thresholds for {len(out_elements)} element(s) to {out_path}")
        return 0

    except requests.HTTPError as e:
        print(
            f"HTTP error: {e.response.status_code} {e.response.reason}",
            file=sys.stderr,
        )
        print(f"URL: {e.response.url}", file=sys.stderr)
        print(f"Body: {e.response.text[:500]}", file=sys.stderr)
        return 1
    except requests.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    # Threshold-extraction mode (added):
    #   python test_v3_elements.py --th "Reshun-Booni_ARG_3"
    if len(sys.argv) > 1 and sys.argv[1] == "--th":
        name = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUTPUT_NAME
        return run_threshold_mode(name)

    # ----- default mode (unchanged) ----------------------------------------
    # The URL comes from the REQUEST_URL variable above. The first command
    # line argument is the OUTPUT FILE NAME (no extension) — e.g.
    #   python test_v3_elements.py "Arkari_WP_2"
    url = REQUEST_URL
    out_name = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT_NAME
    out_name = os.path.basename(out_name.strip())  # no path escapes
    out_name = os.path.splitext(out_name)[0]       # drop any extension given
    out_path = os.path.join(OUTPUT_DIR, out_name + ".json")

    try:
        print("Requesting access token...")
        token = get_access_token()
        print(f"  Got token ({len(token)} chars).\n")

        print(f"GET {url}")
        headers = {"Accept": "*/*", "Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        print(f"  HTTP {response.status_code} {response.reason}\n")
        response.raise_for_status()

        if not response.content:
            print("Empty response body.")
            return 0

        try:
            data = response.json()
        except ValueError:
            print("Response is not JSON. Raw body:\n")
            print(response.text[:2000])
            return 0

        # Pretty-print to stdout
        print("Response JSON:")
        print(json.dumps(data, indent=2, ensure_ascii=False))

        # Save to scripts/outputs/json/<name>
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        record_count = len(data) if isinstance(data, (list, dict)) else "?"
        print(f"\nSaved response ({record_count} record(s)) to {out_path}")
        return 0

    except requests.HTTPError as e:
        print(
            f"HTTP error: {e.response.status_code} {e.response.reason}",
            file=sys.stderr,
        )
        print(f"URL: {e.response.url}", file=sys.stderr)
        print(f"Body: {e.response.text[:500]}", file=sys.stderr)
        return 1
    except requests.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
