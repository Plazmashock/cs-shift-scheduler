#!/usr/bin/env python3
"""
compute_week_summary.py

Usage:
  # From a local JSON file exported from the Realtime DB
  python tools/compute_week_summary.py --file schedules-2025-10-13.json

  # Or pipe JSON via stdin
  curl -s 'https://<DB>.firebaseio.com/schedules/2025-10-13.json?auth=<ID_TOKEN>' | python tools/compute_week_summary.py

  # Or let the script fetch from the DB if you set FIREBASE_DB_URL and store your auth token in `~/.firebase_auth_token`
  FIREBASE_DB_URL='https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app' \
  python tools/compute_week_summary.py --week 2025-10-13

The script prints per-employee total hours and number of shifts and a sample of assignments.
"""
import sys
import json
import argparse
import datetime
from collections import defaultdict
import os
from urllib.parse import urlencode
from urllib.request import urlopen, Request


def parse_args():
    p = argparse.ArgumentParser(description='Summarize a week schedule JSON (Firebase format)')
    p.add_argument('--file', help='Path to local JSON file with schedule object')
    p.add_argument('--week', help='Week key (YYYY-MM-DD) to fetch from FIREBASE_DB_URL with FIREBASE_AUTH set')
    return p.parse_args()


def compute_summary(schedule_obj):
    # Accept either a schedule object with an 'assignments' key, or a list
    if isinstance(schedule_obj, dict):
        assignments = schedule_obj.get('assignments', [])
    elif isinstance(schedule_obj, list):
        assignments = schedule_obj
    else:
        assignments = []
    summary = {}

    for a in assignments:
        emp = a.get('employee_id')
        # normalize employee id where possible
        emp_key = emp
        try:
            if isinstance(emp, (str, int)):
                emp_key = int(emp)
        except Exception:
            emp_key = emp

        name = a.get('employee_name') or a.get('employee') or ''
        start = a.get('start_datetime')
        end = a.get('end_datetime')
        hours = 9.0
        if start and end and isinstance(start, str) and isinstance(end, str):
            try:
                # handle ISO with or without trailing Z
                s = start
                e = end
                if s.endswith('Z'):
                    s = s.replace('Z', '+00:00')
                if e.endswith('Z'):
                    e = e.replace('Z', '+00:00')
                st = datetime.datetime.fromisoformat(s)
                et = datetime.datetime.fromisoformat(e)
                hours = (et - st).total_seconds() / 3600.0
                # Protect against negative or zero durations
                if not (hours > 0):
                    hours = 9.0
            except Exception:
                # fallback to default hours per shift
                hours = 9.0

        # Ensure entry fields exist and update safely
        if emp_key not in summary:
            summary[emp_key] = {'name': name, 'hours': 0.0, 'shifts': 0}
        entry = summary[emp_key]
        # Ensure name is set (don't overwrite a provided name with empty string)
        if not entry.get('name') and name:
            entry['name'] = name
        # Coerce to float and add hours
        prev_hours = entry.get('hours') if entry.get('hours') is not None else 0.0
        try:
            entry['hours'] = float(prev_hours) + float(hours)
        except Exception:
            entry['hours'] = float(hours)

        prev_shifts = entry.get('shifts') if entry.get('shifts') is not None else 0
        try:
            entry['shifts'] = int(prev_shifts) + 1
        except Exception:
            entry['shifts'] = 1

    return assignments, summary


def fetch_week_from_db(db_url, week_key, auth_token=None):
    if not db_url.endswith('/'):
        db_url = db_url + '/'
    url = f"{db_url}schedules/{week_key}.json"
    if auth_token:
        url += f"?auth={auth_token}"
    req = Request(url)
    try:
        with urlopen(req) as fh:
            data = fh.read().decode('utf-8')
        return json.loads(data)
    except Exception as e:
        raise RuntimeError(f"Failed to fetch week {week_key} from {db_url}: {e}")


def main():
    args = parse_args()

    schedule_obj = None
    if args.file:
        with open(args.file, 'r', encoding='utf-8') as fh:
            schedule_obj = json.load(fh)
    elif not sys.stdin.isatty():
        # read from stdin
        try:
            schedule_obj = json.load(sys.stdin)
        except Exception as e:
            print('Failed to parse JSON from stdin:', e, file=sys.stderr)
            sys.exit(2)
    elif args.week:
        db_url = os.environ.get('FIREBASE_DB_URL')
        auth = os.environ.get('FIREBASE_AUTH')
        if not db_url:
            print('FIREBASE_DB_URL not set. Set it or provide --file or pipe JSON to stdin.', file=sys.stderr)
            sys.exit(2)
        if not auth:
            print('FIREBASE_AUTH not set. Set it to a valid ID token (short-lived).', file=sys.stderr)
            sys.exit(2)
        schedule_obj = fetch_week_from_db(db_url, args.week, auth)
    else:
        print('No input provided. Use --file, pipe JSON via stdin, or --week with FIREBASE_* env vars.', file=sys.stderr)
        sys.exit(2)

    if not schedule_obj:
        print('No schedule found (empty object).')
        sys.exit(0)

    assignments, summary = compute_summary(schedule_obj)
    print(f"Total assignments: {len(assignments)}\n")
    for emp, v in sorted(summary.items(), key=lambda x: (x[0] if isinstance(x[0], int) else 9999)):
        print(f"Employee {emp}: {v['name']} — {v['hours']:.1f} hours across {v['shifts']} shifts")

    print('\nSample assignments (up to 10):')
    for a in assignments[:10]:
        print(json.dumps(a, ensure_ascii=False))


if __name__ == '__main__':
    main()
