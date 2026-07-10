"""
CLI entrypoint for schedule generation using a named config from Firebase.
Usage: python generate.py --config-name "MyConfig"
"""
import argparse
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys
import json
from scheduler import build_model_and_solve, export_schedule_csv

# --- Firebase Setup ---
FIREBASE_CRED_PATH = os.environ.get("FIREBASE_CRED_PATH", "serviceAccountKey.json")
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID")

if not firebase_admin._apps:
    cred = credentials.Certificate(FIREBASE_CRED_PATH)
    firebase_admin.initialize_app(cred, {
        'projectId': FIREBASE_PROJECT_ID
    })
db = firestore.client()

def load_config_by_name(config_name):
    configs = db.collection("configs").where("config_name", "==", config_name).order_by("timestamp", direction="DESCENDING").stream()
    for c in configs:
        return c.to_dict()
    return None

def config_to_scheduler_spec(cfg):
    # Convert config JSON to scheduler_v2.py spec format
    spec = {
        "week_start": cfg["week_start"],
        "employees": [
            {"id": int(e["id"]), "name": e["name"]}
            for e in cfg["employees"] if e.get("active", True) and e.get("role", "Agent") == "Agent"
        ],
        "timezone": cfg.get("timezone", "UTC"),
        "max_solve_time": 30
    }
    return spec

def main():
    parser = argparse.ArgumentParser(description="Generate schedule for a named config")
    parser.add_argument("--config-name", required=True, help="Name of the config to use")
    parser.add_argument("--out-csv", help="Path to export CSV schedule")
    args = parser.parse_args()
    cfg = load_config_by_name(args.config_name)
    if not cfg:
        print(f"Config '{args.config_name}' not found.")
        sys.exit(1)
    print(f"Loaded config: {cfg['config_name']}")
    spec = config_to_scheduler_spec(cfg)
    print(f"Generating schedule for {len(spec['employees'])} agents...")
    result = build_model_and_solve(spec)
    print(f"Status: {result['status']}")
    print(f"Total assignments: {result.get('total_assignments', 0)}")
    print(f"Solve time: {result.get('solve_time', 0):.2f}s")
    if result.get('error'):
        print(f"Error: {result['error']}")
    if result.get('assignments'):
        print(f"Sample assignments (first 5):")
        for a in result['assignments'][:5]:
            print(a)
        if args.out_csv:
            export_schedule_csv(result['assignments'], args.out_csv)
            print(f"Schedule exported to {args.out_csv}")

if __name__ == "__main__":
    main()
