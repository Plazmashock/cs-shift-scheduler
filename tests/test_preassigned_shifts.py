#!/usr/bin/env python3
"""
Test pre-assigned shifts functionality.
Tests that the scheduler correctly handles pre-assigned shifts and doesn't fail
when they violate the 12-hour rest constraint.
"""

import json
import os
from datetime import datetime, timedelta
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'functions'))

from scheduler import build_model_and_solve


def test_preassigned_shifts_with_rest_violation():
    """
    Test that pre-assigned shifts can override the 12-hour rest constraint.
    
    Setup:
    - Employee 1: Pre-assigned to Monday afternoon (15:00-00:00) and Tuesday day (10:00-19:00)
      These violate the 12-hour rest rule (only 10 hours rest)
    - Other employees: Normal assignment
    
    Expected:
    - Schedule should be generated successfully
    - Employee 1 should have the pre-assigned shifts locked in
    - Problem should NOT fail due to the 12-hour rest violation
    """
    # Get week starting Monday, Jan 13, 2025
    week_start = "2025-01-13"
    
    # Create 7 employees (need at least 7 for morning coverage)
    employees = [
        {"id": 1, "name": "Employee 1", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 2, "name": "Employee 2", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 3, "name": "Employee 3", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 4, "name": "Employee 4", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 5, "name": "Employee 5", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 6, "name": "Employee 6", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 7, "name": "Employee 7", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
    ]
    
    # Pre-assign shifts that violate the 12-hour rest rule
    # Afternoon Mon (ends 00:00 Tue) → Day Tue (starts 10:00) = only 10 hours
    pre_assigned_shifts = [
        {
            "employee_id": 1,
            "date": "2025-01-13",  # Monday
            "shift_type": "afternoon"
        },
        {
            "employee_id": 1,
            "date": "2025-01-14",  # Tuesday (violates 12-hour rule)
            "shift_type": "day"
        }
    ]
    
    # Build spec
    spec = {
        "week_start": week_start,
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "options": {
            "allow_exception": False,
            "solver_time_limit": 60,
            "use_greedy_fallback": True
        }
    }
    
    print("=" * 70)
    print("TEST: Pre-assigned shifts with 12-hour rest violation")
    print("=" * 70)
    print(f"Week: {week_start}")
    print(f"Pre-assigned shifts: {pre_assigned_shifts}")
    print()
    
    # Solve
    result = build_model_and_solve(spec)
    
    print()
    print("=" * 70)
    print("RESULT")
    print("=" * 70)
    
    status = result.get("status", "unknown")
    is_success = status in ["optimal", "feasible"]
    
    if not is_success:
        print(f"❌ FAILED: {status}")
        print(f"Error: {result.get('error')}")
        return False
    
    print(f"✅ SUCCESS: Schedule generated in {result.get('solver_time', 0):.2f}s")
    
    # Verify Employee 1 has the pre-assigned shifts
    assignments = result.get("assignments", [])
    emp1_shifts = [a for a in assignments if a["employee_id"] == 1]
    
    print(f"\nEmployee 1 shifts:")
    for shift in emp1_shifts:
        print(f"  - {shift['date']} {shift['shift_type']}")
    
    # Check that Employee 1 has the pre-assigned shifts
    pre_assigned_dates = {
        ("2025-01-13", "afternoon"),
        ("2025-01-14", "day")
    }
    actual_dates = {(s["date"], s["shift_type"]) for s in emp1_shifts}
    
    if pre_assigned_dates.issubset(actual_dates):
        print("\n✅ Pre-assigned shifts are in the solution!")
        return True
    else:
        print(f"\n❌ Pre-assigned shifts missing!")
        print(f"Expected: {pre_assigned_dates}")
        print(f"Got: {actual_dates}")
        return False


def test_preassigned_shifts_simple():
    """
    Test simple pre-assigned shifts without rest violations.
    """
    week_start = "2025-01-13"
    
    employees = [
        {"id": 1, "name": "Employee 1", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 2, "name": "Employee 2", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 3, "name": "Employee 3", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 4, "name": "Employee 4", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 5, "name": "Employee 5", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 6, "name": "Employee 6", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
        {"id": 7, "name": "Employee 7", "past_week_counts": {"night": 1, "day": 1, "afternoon": 2}},
    ]
    
    # Pre-assign 2 shifts to Employee 1 (no rest violations)
    pre_assigned_shifts = [
        {"employee_id": 1, "date": "2025-01-13", "shift_type": "morning"},
        {"employee_id": 1, "date": "2025-01-14", "shift_type": "night"},
    ]
    
    spec = {
        "week_start": week_start,
        "employees": employees,
        "pre_assigned_shifts": pre_assigned_shifts,
        "options": {"solver_time_limit": 60}
    }
    
    print("\n" + "=" * 70)
    print("TEST: Simple pre-assigned shifts (no rest violations)")
    print("=" * 70)
    
    result = build_model_and_solve(spec)
    
    status = result.get("status", "unknown")
    is_success = status in ["optimal", "feasible"]
    
    if not is_success:
        print(f"❌ FAILED: {status}")
        print(f"Error: {result.get('error')}")
        return False
    
    print(f"✅ SUCCESS: Schedule generated")
    
    assignments = result.get("assignments", [])
    emp1_shifts = [a for a in assignments if a["employee_id"] == 1]
    
    print(f"Employee 1 shifts: {len(emp1_shifts)}")
    for shift in emp1_shifts:
        print(f"  - {shift['date']} {shift['shift_type']}")
    
    # Check total shifts = 5
    if len(emp1_shifts) == 5:
        print("✅ Employee 1 has exactly 5 shifts")
        return True
    else:
        print(f"❌ Employee 1 has {len(emp1_shifts)} shifts (expected 5)")
        return False


if __name__ == "__main__":
    test1 = test_preassigned_shifts_simple()
    test2 = test_preassigned_shifts_with_rest_violation()
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Test 1 (Simple): {'PASSED' if test1 else 'FAILED'}")
    print(f"Test 2 (Rest Violation): {'PASSED' if test2 else 'FAILED'}")
    
    if test1 and test2:
        print("\n✅ ALL TESTS PASSED!")
        sys.exit(0)
    else:
        print("\n❌ SOME TESTS FAILED")
        sys.exit(1)
