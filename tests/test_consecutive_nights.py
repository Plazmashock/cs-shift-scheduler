#!/usr/bin/env python3
"""
Test script to verify the consecutive night shift constraint works correctly.
"""

import json
from scheduler import build_model_and_solve

def test_consecutive_nights_constraint():
    """Test that the consecutive night shift constraint is applied correctly."""
    
    print("🧪 Testing Consecutive Night Shift Constraint\n")
    
    # Test Case 1: Employee had both Saturday and Sunday nights
    print("=" * 60)
    print("Test Case 1: Employee had Sat + Sun nights")
    print("Expected: Monday night should be penalized (soft constraint)")
    print("=" * 60)
    
    spec1 = {
        "week_start": "2025-12-08",  # Monday, Dec 8
        "timezone": "UTC",
        "allow_same_day_morning_night_exception": False,
        "max_solve_time": 10,
        "employees": [
            {
                "id": "emp1",
                "name": "Alice",
                "last_two_days_nights": ["2025-12-06", "2025-12-07"]  # Sat + Sun
            },
            {
                "id": "emp2",
                "name": "Bob",
                "last_two_days_nights": []
            },
            {
                "id": "emp3",
                "name": "Charlie",
                "last_two_days_nights": []
            },
            {
                "id": "emp4",
                "name": "David",
                "last_two_days_nights": []
            },
            {
                "id": "emp5",
                "name": "Eve",
                "last_two_days_nights": []
            },
            {
                "id": "emp6",
                "name": "Frank",
                "last_two_days_nights": []
            },
            {
                "id": "emp7",
                "name": "Grace",
                "last_two_days_nights": []
            },
            {
                "id": "emp8",
                "name": "Henry",
                "last_two_days_nights": []
            },
            {
                "id": "emp9",
                "name": "Iris",
                "last_two_days_nights": []
            },
            {
                "id": "emp10",
                "name": "Jack",
                "last_two_days_nights": []
            }
        ]
    }
    
    try:
        result1 = build_model_and_solve(spec1)
        
        if result1.get("status") in ["OPTIMAL", "optimal", "FEASIBLE", "feasible"]:
            print(f"✅ Status: {result1['status']}")
            
            # Check if Alice got Monday night shift
            monday_nights = [a for a in result1["assignments"] 
                            if a["date"] == "2025-12-08" and a["shift_type"] == "night"]
            
            alice_monday_night = any(a["employee_id"] == "emp1" for a in monday_nights)
            
            if alice_monday_night:
                print("⚠️  Alice got Monday night (soft constraint penalty applied but not blocked)")
            else:
                print("✅ Alice did NOT get Monday night (constraint working!)")
                
            print(f"\nMonday night assignments: {[a['employee_name'] for a in monday_nights]}")
            
            # Also check all of Alice's shifts
            alice_shifts = [a for a in result1["assignments"] if a["employee_id"] == "emp1"]
            print(f"\nAlice's full schedule:")
            for shift in sorted(alice_shifts, key=lambda x: (x['date'], x['shift_type'])):
                print(f"  {shift['date']} - {shift['shift_type']}")
        else:
            print(f"❌ Status: {result1['status']}")
            print(f"Message: {result1.get('message', 'N/A')}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    print("\n")
    
    # Test Case 2: Employee had only Sunday night
    print("=" * 60)
    print("Test Case 2: Employee had only Sun night")
    print("Expected: Mon + Tue nights should be penalized")
    print("=" * 60)
    
    spec2 = {
        "week_start": "2025-12-08",
        "timezone": "UTC",
        "allow_same_day_morning_night_exception": False,
        "max_solve_time": 10,
        "employees": [
            {
                "id": "emp1",
                "name": "Alice",
                "last_two_days_nights": ["2025-12-07"]  # Only Sun
            },
            {
                "id": "emp2",
                "name": "Bob",
                "last_two_days_nights": []
            },
            {
                "id": "emp3",
                "name": "Charlie",
                "last_two_days_nights": []
            },
            {
                "id": "emp4",
                "name": "David",
                "last_two_days_nights": []
            },
            {
                "id": "emp5",
                "name": "Eve",
                "last_two_days_nights": []
            },
            {
                "id": "emp6",
                "name": "Frank",
                "last_two_days_nights": []
            },
            {
                "id": "emp7",
                "name": "Grace",
                "last_two_days_nights": []
            },
            {
                "id": "emp8",
                "name": "Henry",
                "last_two_days_nights": []
            },
            {
                "id": "emp9",
                "name": "Iris",
                "last_two_days_nights": []
            },
            {
                "id": "emp10",
                "name": "Jack",
                "last_two_days_nights": []
            }
        ]
    }
    
    try:
        result2 = build_model_and_solve(spec2)
        
        if result2.get("status") in ["OPTIMAL", "optimal", "FEASIBLE", "feasible"]:
            print(f"✅ Status: {result2['status']}")
            
            # Check if Alice got Monday or Tuesday night
            monday_nights = [a for a in result2["assignments"] 
                            if a["date"] == "2025-12-08" and a["shift_type"] == "night"]
            tuesday_nights = [a for a in result2["assignments"] 
                             if a["date"] == "2025-12-09" and a["shift_type"] == "night"]
            
            alice_monday = any(a["employee_id"] == "emp1" for a in monday_nights)
            alice_tuesday = any(a["employee_id"] == "emp1" for a in tuesday_nights)
            
            if alice_monday or alice_tuesday:
                print(f"⚠️  Alice got {'Monday' if alice_monday else ''} {'Tuesday' if alice_tuesday else ''} night")
            else:
                print("✅ Alice did NOT get Mon or Tue nights (constraint working!)")
                
            print(f"\nMonday night: {[a['employee_name'] for a in monday_nights]}")
            print(f"Tuesday night: {[a['employee_name'] for a in tuesday_nights]}")
            
            # Also check all of Alice's shifts
            alice_shifts = [a for a in result2["assignments"] if a["employee_id"] == "emp1"]
            print(f"\nAlice's full schedule:")
            for shift in sorted(alice_shifts, key=lambda x: (x['date'], x['shift_type'])):
                print(f"  {shift['date']} - {shift['shift_type']}")
        else:
            print(f"❌ Status: {result2['status']}")
            print(f"Message: {result2.get('message', 'N/A')}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    print("\n" + "=" * 60)
    print("✅ Consecutive night shift constraint test complete!")
    print("=" * 60)

if __name__ == "__main__":
    test_consecutive_nights_constraint()
