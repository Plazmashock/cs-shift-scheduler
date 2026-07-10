#!/usr/bin/env python3
"""
Simple test: Verify 12-hour rest rule is enforced for pre-assigned shifts
"""

from scheduler import build_model_and_solve

# Configuration with 7 employees for feasible coverage
EMPLOYEES = [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"},
    {"id": 3, "name": "Charlie"},
    {"id": 4, "name": "Diana"},
    {"id": 5, "name": "Eve"},
    {"id": 6, "name": "Frank"},
    {"id": 7, "name": "Grace"}
]

SHIFT_DEFS = {
    "morning": {"label": "morning", "start_hour": 4, "start_minute": 0, "end_hour": 13, "end_minute": 0, "min_staff": 1, "max_staff": 1},
    "day": {"label": "day", "start_hour": 10, "start_minute": 0, "end_hour": 19, "end_minute": 0, "min_staff": 1, "max_staff": 3},
    "afternoon": {"label": "afternoon", "start_hour": 15, "start_minute": 0, "end_hour": 0, "end_minute": 0, "min_staff": 1, "max_staff": 5},
    "night": {"label": "night", "start_hour": 19, "start_minute": 0, "end_hour": 4, "end_minute": 0, "min_staff": 1, "max_staff": 5}
}

print("\n" + "="*80)
print("TEST: Pre-assigned shifts and 12-hour rest rule")
print("="*80)

# Test 1: VIOLATION - Night Mon + Day Tue (only 6 hours rest)
print("\n1. Testing pre-assigned shifts that VIOLATE 12-hour rest...")
print("   Alice: Night Monday (ends 04:00 Tue) + Day Tuesday (starts 10:00) = 6h rest")
spec1 = {
    "week_start": "2026-01-26",
    "employees": EMPLOYEES,
    "pre_assigned_shifts": [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "night"},
        {"employee_id": 1, "date": "2026-01-27", "shift_type": "day"},
    ],
    "shift_definitions": SHIFT_DEFS
}

result1 = build_model_and_solve(spec1)
print(f"   Status: {result1.get('status', 'unknown')}")
print(f"   Feasible: {result1.get('feasible', False)}")
if 'error' in result1:
    print(f"   Error: {result1['error']}")
    if 'PRE_ASSIGNED_SHIFTS_VIOLATE_REST_RULE' in result1.get('error', ''):
        print("   ✅ PASS: Correctly rejected - 12-hour rest violated")
    else:
        print(f"   ⚠️ Different error (expected pre-assigned rest violation)")
else:
    print("   ❌ FAIL: Should have been rejected!")

print("\n" + "-"*80)

# Test 2: VALID - Night Mon + Night Wed (full day between)
print("\n2. Testing pre-assigned shifts that RESPECT 12-hour rest...")
print("   Alice: Night Monday + Night Wednesday (full day gap)")
spec2 = {
    "week_start": "2026-01-26",
    "employees": EMPLOYEES,
    "pre_assigned_shifts": [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "night"},
        {"employee_id": 1, "date": "2026-01-28", "shift_type": "night"},
    ],
    "shift_definitions": SHIFT_DEFS
}

result2 = build_model_and_solve(spec2)
print(f"   Status: {result2.get('status', 'unknown')}")
is_feasible = result2.get('status') in ['optimal', 'feasible']
print(f"   Feasible: {is_feasible}")
if is_feasible:
    schedule = result2.get('assignments', [])
    alice_shifts = [s for s in schedule if s.get('employee_id') == 1]
    print(f"   Alice has {len(alice_shifts)} shifts")
    if len(alice_shifts) == 5:
        print("   ✅ PASS: Valid pre-assigned shifts work, 5-shift rule enforced")
        for s in sorted(alice_shifts, key=lambda x: x['date']):
            print(f"       {s['date']} {s['shift_type']}")
    else:
        print(f"   ⚠️ Alice has {len(alice_shifts)} shifts (expected 5)")
else:
    print(f"   ❌ FAIL: Should be feasible!")
    if 'error' in result2:
        print(f"   Error: {result2.get('error', 'unknown')}")

print("\n" + "="*80)
print("TEST COMPLETED")
print("="*80 + "\n")
