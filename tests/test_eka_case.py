#!/usr/bin/env python3
"""
Test script to reproduce Eka's case:
- Nov 22 (Sat): night
- Nov 23 (Sun): night
- Nov 24 (Mon): Should NOT get night (would be 3rd consecutive)
- Nov 25 (Tue): Should NOT get night (would be 4th consecutive)
"""

import json
from scheduler import build_model_and_solve

def test_elene_consecutive_nights():
    """Test that Eka doesn't get Mon/Tue nights after Sat/Sun nights."""
    
    print("🧪 Testing Eka's Case: Sat-Sun nights preventing Mon-Tue nights\n")
    print("=" * 70)
    print("Previous week: Nov 22 (Sat) night + Nov 23 (Sun) night")
    print("Current week starts: Nov 24 (Mon)")
    print("Expected: Eka should NOT get Mon or Tue nights (weight=10 and 12)")
    print("=" * 70)
    
    spec = {
        "week_start": "2025-11-24",  # Monday, Nov 24
        "timezone": "UTC",
        "allow_same_day_morning_night_exception": False,
        "max_solve_time": 30,
        "employees": [
            {
                "id": "emp1",
                "name": "Eka Tsiklauri",
                "trailing_consecutive_nights": 2,  # Had Sat + Sun nights
                "trailing_consecutive_work_days": 2  # Worked Sat + Sun
            },
            {
                "id": "emp2",
                "name": "Employee 2",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp3",
                "name": "Employee 3",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp4",
                "name": "Employee 4",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp5",
                "name": "Employee 5",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp6",
                "name": "Employee 6",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp7",
                "name": "Employee 7",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp8",
                "name": "Employee 8",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp9",
                "name": "Employee 9",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            },
            {
                "id": "emp10",
                "name": "Employee 10",
                "trailing_consecutive_nights": 0,
                "trailing_consecutive_work_days": 0
            }
        ]
    }
    
    try:
        result = build_model_and_solve(spec)
        
        if result.get("status") in ["OPTIMAL", "optimal", "FEASIBLE", "feasible"]:
            print(f"\n✅ Status: {result['status']}\n")
            
            # Check Eka's assignments
            elene_shifts = [a for a in result["assignments"] if a["employee_id"] == "emp1"]
            
            # Check Monday (Nov 24) and Tuesday (Nov 25) nights specifically
            monday_night = [a for a in elene_shifts if a["date"] == "2025-11-24" and a["shift_type"] == "night"]
            tuesday_night = [a for a in elene_shifts if a["date"] == "2025-11-25" and a["shift_type"] == "night"]
            
            print("Eka's full schedule:")
            for shift in sorted(elene_shifts, key=lambda x: (x['date'], x['shift_type'])):
                print(f"  {shift['date']} ({shift['date'][:10]}) - {shift['shift_type']}")
            
            print("\nMonday night assignments:")
            monday_all_nights = [a for a in result["assignments"] if a["date"] == "2025-11-24" and a["shift_type"] == "night"]
            for a in monday_all_nights:
                print(f"  {a['employee_name']}")
            
            print("\nTuesday night assignments:")
            tuesday_all_nights = [a for a in result["assignments"] if a["date"] == "2025-11-25" and a["shift_type"] == "night"]
            for a in tuesday_all_nights:
                print(f"  {a['employee_name']}")
            
            print("\n" + "=" * 70)
            if monday_night:
                print("❌ FAIL: Eka got Monday night (should be heavily penalized!)")
                print(f"   Penalty should be: 10")
            else:
                print("✅ PASS: Eka did NOT get Monday night")
            
            if tuesday_night:
                print("❌ FAIL: Eka got Tuesday night (should be heavily penalized!)")
                print(f"   Penalty should be: 12")
            else:
                print("✅ PASS: Eka did NOT get Tuesday night")
            
            if not monday_night and not tuesday_night:
                print("\n🎉 SUCCESS: Constraint is working correctly!")
            else:
                print("\n⚠️  FAILURE: Constraint is NOT working - penalties too weak!")
                
        else:
            print(f"❌ Status: {result['status']}")
            print(f"Message: {result.get('message', 'N/A')}")
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_elene_consecutive_nights()
