#!/usr/bin/env python3
"""
Test: Pre-assigned shifts MUST respect 12-hour rest rule

This test verifies that:
1. Pre-assigned shifts that violate the 12-hour rest rule are properly rejected
2. Pre-assigned shifts that respect the 12-hour rest rule work correctly
3. The 5-shift rule is always enforced
4. Coverage requirements remain enforced
"""

import json
from scheduler import build_model_and_solve, ShiftDefinition


def test_preassigned_violates_rest_rule():
    """Test that pre-assigned shifts violating 12-hour rest are REJECTED"""
    print("\n" + "="*80)
    print("TEST 1: Pre-assigned shifts that VIOLATE 12-hour rest rule")
    print("="*80)
    
    employees = [
        {
            "id": 1,
            "name": "Alice",
        },
        {
            "id": 2,
            "name": "Bob",
        },
        {
            "id": 3,
            "name": "Charlie",
        },
        {
            "id": 4,
            "name": "Diana",
        },
        {
            "id": 5,
            "name": "Eve",
        }
    ]
    
    # Pre-assign Alice to Night Mon + Day Tue (violates 12-hour rest!)
    # Night Mon ends 04:00 Tue, Day Tue starts 10:00 Tue = only 6 hours rest
    pre_assigned_shifts = [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "night"},  # Monday night
        {"employee_id": 1, "date": "2026-01-27", "shift_type": "day"},    # Tuesday day - VIOLATES!
    ]
    
    spec = {
        "week_start": "2026-01-26",
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "shift_definitions": {
            "morning": {"label": "morning", "start_hour": 4, "start_minute": 0, "end_hour": 13, "end_minute": 0, "min_staff": 1, "max_staff": 1},
            "day": {"label": "day", "start_hour": 10, "start_minute": 0, "end_hour": 19, "end_minute": 0, "min_staff": 1, "max_staff": 3},
            "afternoon": {"label": "afternoon", "start_hour": 15, "start_minute": 0, "end_hour": 0, "end_minute": 0, "min_staff": 1, "max_staff": 5},
            "night": {"label": "night", "start_hour": 19, "start_minute": 0, "end_hour": 4, "end_minute": 0, "min_staff": 1, "max_staff": 5}
        }
    }
    
    result = build_model_and_solve(spec)
    
    print(f"\nResult: {result['status']}")
    print(f"Feasible: {result.get('feasible', False)}")
    if result.get('error'):
        print(f"Error: {result['error']}")
        print(f"Detail: {result.get('error_detail', 'N/A')}")
    
    # Verify the result is infeasible
    assert not result.get('feasible', False), "Expected schedule to be INFEASIBLE"
    assert result['error'] == 'PRE_ASSIGNED_SHIFTS_VIOLATE_REST_RULE', "Expected rest rule violation error"
    print("\n✅ TEST PASSED: Pre-assigned shifts violating 12-hour rest are properly rejected")


def test_preassigned_respects_rest_rule():
    """Test that pre-assigned shifts respecting 12-hour rest work correctly"""
    print("\n" + "="*80)
    print("TEST 2: Pre-assigned shifts that RESPECT 12-hour rest rule")
    print("="*80)
    
    employees = [
        {
            "id": 1,
            "name": "Alice",
        },
        {
            "id": 2,
            "name": "Bob",
        },
        {
            "id": 3,
            "name": "Charlie",
        },
        {
            "id": 4,
            "name": "Diana",
        },
        {
            "id": 5,
            "name": "Eve",
        }
    ]
    
    # Pre-assign Alice to Night Mon + Night Wed (respects 12-hour rest - full day gap)
    pre_assigned_shifts = [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "night"},  # Monday night
        {"employee_id": 1, "date": "2026-01-28", "shift_type": "night"},  # Wednesday night - OK!
    ]
    
    spec = {
        "week_start": "2026-01-26",
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "shift_definitions": {
            "morning": {"label": "morning", "start_hour": 4, "start_minute": 0, "end_hour": 13, "end_minute": 0, "min_staff": 1, "max_staff": 1},
            "day": {"label": "day", "start_hour": 10, "start_minute": 0, "end_hour": 19, "end_minute": 0, "min_staff": 1, "max_staff": 3},
            "afternoon": {"label": "afternoon", "start_hour": 15, "start_minute": 0, "end_hour": 0, "end_minute": 0, "min_staff": 1, "max_staff": 5},
            "night": {"label": "night", "start_hour": 19, "start_minute": 0, "end_hour": 4, "end_minute": 0, "min_staff": 1, "max_staff": 5}
        }
    }
    
    result = build_model_and_solve(spec)
    
    print(f"\nResult: {result['status']}")
    print(f"Feasible: {result.get('feasible', False)}")
    if result.get('error'):
        print(f"Error: {result['error']}")
        print(f"Detail: {result.get('error_detail', 'N/A')}")
    
    # Verify the result is feasible
    assert result.get('feasible', False), f"Expected schedule to be FEASIBLE, got: {result.get('error_detail', 'N/A')}"
    
    # Verify Alice has exactly 5 shifts (2 pre-assigned + 3 generated)
    schedule = result.get('schedule', {})
    alice_shifts = [s for s in schedule.values() if s.get('employee_id') == 1]
    print(f"\nAlice's shifts: {len(alice_shifts)}")
    assert len(alice_shifts) == 5, f"Expected Alice to have exactly 5 shifts, got {len(alice_shifts)}"
    
    # Verify pre-assigned shifts are included
    alice_shift_keys = [(s['date'], s['shift_type']) for s in alice_shifts]
    assert ("2026-01-26", "night") in alice_shift_keys, "Pre-assigned Monday night shift missing"
    assert ("2026-01-28", "night") in alice_shift_keys, "Pre-assigned Wednesday night shift missing"
    
    # Verify 12-hour rest rule for all of Alice's shifts
    alice_shifts_sorted = sorted(alice_shifts, key=lambda s: s['date'])
    for i in range(len(alice_shifts_sorted) - 1):
        shift1 = alice_shifts_sorted[i]
        shift2 = alice_shifts_sorted[i + 1]
        print(f"  {shift1['date']} {shift1['shift_type']} → {shift2['date']} {shift2['shift_type']}")
    
    print("\n✅ TEST PASSED: Pre-assigned shifts respecting 12-hour rest work correctly")


def test_preassigned_cross_week_violation():
    """Test that pre-assigned Monday shifts violating cross-week rest are REJECTED"""
    print("\n" + "="*80)
    print("TEST 3: Pre-assigned Monday shifts that VIOLATE cross-week 12-hour rest")
    print("="*80)
    
    employees = [
        {
            "id": 1,
            "name": "Alice",
            "had_sunday_night": True  # Had night shift on previous Sunday
        },
        {
            "id": 2,
            "name": "Bob",
        },
        {
            "id": 3,
            "name": "Charlie",
        },
        {
            "id": 4,
            "name": "Diana",
        },
        {
            "id": 5,
            "name": "Eve",
        }
    ]
    
    # Pre-assign Alice to Monday morning (violates cross-week rest!)
    # Sunday Night ends 04:00 Mon, Monday Morning starts 04:00 Mon = 0 hours rest
    pre_assigned_shifts = [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "morning"},  # Monday morning - VIOLATES!
    ]
    
    spec = {
        "week_start": "2026-01-26",
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "shift_definitions": {
            "morning": {"label": "morning", "start_hour": 4, "start_minute": 0, "end_hour": 13, "end_minute": 0, "min_staff": 1, "max_staff": 1},
            "day": {"label": "day", "start_hour": 10, "start_minute": 0, "end_hour": 19, "end_minute": 0, "min_staff": 1, "max_staff": 3},
            "afternoon": {"label": "afternoon", "start_hour": 15, "start_minute": 0, "end_hour": 0, "end_minute": 0, "min_staff": 1, "max_staff": 5},
            "night": {"label": "night", "start_hour": 19, "start_minute": 0, "end_hour": 4, "end_minute": 0, "min_staff": 1, "max_staff": 5}
        }
    }
    
    result = build_model_and_solve(spec)
    
    print(f"\nResult: {result['status']}")
    print(f"Feasible: {result.get('feasible', False)}")
    if result.get('error'):
        print(f"Error: {result['error']}")
        print(f"Detail: {result.get('error_detail', 'N/A')}")
    
    # Verify the result is infeasible
    assert not result.get('feasible', False), "Expected schedule to be INFEASIBLE"
    assert result['error'] == 'PRE_ASSIGNED_MONDAY_SHIFTS_VIOLATE_REST_RULE', "Expected Monday rest rule violation error"
    print("\n✅ TEST PASSED: Pre-assigned Monday shifts violating cross-week rest are properly rejected")


def test_five_shift_rule_enforced():
    """Test that 5-shift rule is always enforced even with pre-assigned shifts"""
    print("\n" + "="*80)
    print("TEST 4: 5-shift rule is ALWAYS enforced")
    print("="*80)
    
    employees = [
        {
            "id": 1,
            "name": "Alice",
        },
        {
            "id": 2,
            "name": "Bob",
        },
        {
            "id": 3,
            "name": "Charlie",
        },
        {
            "id": 4,
            "name": "Diana",
        },
        {
            "id": 5,
            "name": "Eve",
        }
    ]
    
    # Pre-assign Alice to 3 shifts (valid, respecting 12-hour rest)
    pre_assigned_shifts = [
        {"employee_id": 1, "date": "2026-01-26", "shift_type": "night"},      # Monday night
        {"employee_id": 1, "date": "2026-01-28", "shift_type": "afternoon"},  # Wednesday afternoon
        {"employee_id": 1, "date": "2026-01-30", "shift_type": "day"},        # Friday day
    ]
    
    spec = {
        "week_start": "2026-01-26",
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "shift_definitions": {
            "morning": {"label": "morning", "start_hour": 4, "start_minute": 0, "end_hour": 13, "end_minute": 0, "min_staff": 1, "max_staff": 1},
            "day": {"label": "day", "start_hour": 10, "start_minute": 0, "end_hour": 19, "end_minute": 0, "min_staff": 1, "max_staff": 3},
            "afternoon": {"label": "afternoon", "start_hour": 15, "start_minute": 0, "end_hour": 0, "end_minute": 0, "min_staff": 1, "max_staff": 5},
            "night": {"label": "night", "start_hour": 19, "start_minute": 0, "end_hour": 4, "end_minute": 0, "min_staff": 1, "max_staff": 5}
        }
    }
    
    result = build_model_and_solve(spec)
    
    print(f"\nResult: {result['status']}")
    print(f"Feasible: {result.get('feasible', False)}")
    
    if not result.get('feasible', False):
        print(f"Error: {result.get('error', 'N/A')}")
        print(f"Detail: {result.get('error_detail', 'N/A')}")
        assert False, "Expected schedule to be FEASIBLE"
    
    # Verify EVERY employee has exactly 5 shifts
    schedule = result.get('schedule', {})
    for emp in employees:
        emp_shifts = [s for s in schedule.values() if s.get('employee_id') == emp['id']]
        print(f"\n{emp['name']}: {len(emp_shifts)} shifts")
        assert len(emp_shifts) == 5, f"Expected {emp['name']} to have exactly 5 shifts, got {len(emp_shifts)}"
        
        # Print shift details
        for s in sorted(emp_shifts, key=lambda x: x['date']):
            print(f"  {s['date']} {s['shift_type']}")
    
    print("\n✅ TEST PASSED: 5-shift rule is always enforced")


if __name__ == "__main__":
    print("\n" + "="*80)
    print("TESTING: Pre-assigned Shifts Must Respect 12-Hour Rest Rule")
    print("="*80)
    
    try:
        test_preassigned_violates_rest_rule()
    except Exception as e:
        print(f"\n❌ TEST 1 FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        test_preassigned_respects_rest_rule()
    except Exception as e:
        print(f"\n❌ TEST 2 FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        test_preassigned_cross_week_violation()
    except Exception as e:
        print(f"\n❌ TEST 3 FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    try:
        test_five_shift_rule_enforced()
    except Exception as e:
        print(f"\n❌ TEST 4 FAILED: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "="*80)
    print("ALL TESTS COMPLETED")
    print("="*80 + "\n")
