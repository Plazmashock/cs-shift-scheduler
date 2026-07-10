#!/usr/bin/env python3
"""
Test: High-Traffic Days selector actually prioritizes selected days
"""

from scheduler import build_model_and_solve

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
print("TEST: High-Traffic Days selector respects user selection")
print("="*80)

# Test 1: Friday as high-traffic day (day_of_week = 4)
print("\n1. Testing with FRIDAY as high-traffic day...")
spec1 = {
    "week_start": "2026-02-16",  # Monday Feb 16, so Friday is Feb 20
    "employees": EMPLOYEES,
    "high_traffic_days": [4],  # Friday = 4 (0=Mon, 4=Fri, 6=Sun)
    "shift_definitions": SHIFT_DEFS
}

result1 = build_model_and_solve(spec1)
if result1.get('status') in ['optimal', 'feasible']:
    assignments = result1.get('assignments', [])
    
    # Count afternoon/night staff for each day
    from datetime import datetime
    day_counts = {}
    all_day_counts = {}  # Count ALL shifts
    for a in assignments:
        date = a['date']
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        day_name = date_obj.strftime('%A')
        day_of_week = date_obj.weekday()
        
        key = f"{day_name} ({date})"
        
        # Count afternoon/night only
        if a['shift_type'] in ['afternoon', 'night']:
            if key not in day_counts:
                day_counts[key] = 0
            day_counts[key] += 1
        
        # Count ALL shifts
        if key not in all_day_counts:
            all_day_counts[key] = 0
        all_day_counts[key] += 1
    
    print("\n   TOTAL staffing by day (ALL shifts):")
    for day, count in sorted(all_day_counts.items()):
        marker = " ⭐ HIGH-TRAFFIC" if "Feb 20" in day else ""  # Friday Feb 20
        print(f"      {day}: {count} total staff{marker}")
    
    print("\n   Afternoon/Night staffing by day:")
    for day, count in sorted(day_counts.items()):
        marker = " ⭐ HIGH-TRAFFIC" if "Feb 20" in day else ""  # Friday Feb 20
        print(f"      {day}: {count} staff{marker}")
    
    # Check if Friday has more TOTAL staff than Sunday
    friday_count = all_day_counts.get("Friday (2026-02-20)", 0)
    sunday_count = all_day_counts.get("Sunday (2026-02-22)", 0)
    
    if friday_count >= sunday_count:
        print(f"\n   ✅ PASS: Friday ({friday_count} staff) has more/equal staff than Sunday ({sunday_count} staff)")
    else:
        print(f"\n   ❌ FAIL: Friday ({friday_count} staff) has LESS staff than Sunday ({sunday_count} staff)")
        print("          High-Traffic Days selector is NOT working correctly!")
else:
    print(f"   ❌ Schedule generation failed: {result1.get('error', 'unknown')}")

print("\n" + "-"*80)

# Test 2: Sunday as high-traffic day (day_of_week = 6)
print("\n2. Testing with SUNDAY as high-traffic day...")
spec2 = {
    "week_start": "2026-02-16",
    "employees": EMPLOYEES,
    "high_traffic_days": [6],  # Sunday = 6
    "shift_definitions": SHIFT_DEFS
}

result2 = build_model_and_solve(spec2)
if result2.get('status') in ['optimal', 'feasible']:
    assignments = result2.get('assignments', [])
    
    day_counts = {}
    all_day_counts = {}  # Count ALL shifts
    for a in assignments:
        date = a['date']
        date_obj = datetime.strptime(date, '%Y-%m-%d')
        day_name = date_obj.strftime('%A')
        
        key = f"{day_name} ({date})"
        
        # Count afternoon/night only
        if a['shift_type'] in ['afternoon', 'night']:
            if key not in day_counts:
                day_counts[key] = 0
            day_counts[key] += 1
        
        # Count ALL shifts
        if key not in all_day_counts:
            all_day_counts[key] = 0
        all_day_counts[key] += 1
    
    print("\n   TOTAL staffing by day (ALL shifts):")
    for day, count in sorted(all_day_counts.items()):
        marker = " ⭐ HIGH-TRAFFIC" if "Feb 22" in day else ""  # Sunday Feb 22
        print(f"      {day}: {count} total staff{marker}")
    
    print("\n   Afternoon/Night staffing by day:")
    for day, count in sorted(day_counts.items()):
        marker = " ⭐ HIGH-TRAFFIC" if "Feb 22" in day else ""  # Sunday Feb 22
        print(f"      {day}: {count} staff{marker}")
    
    # Check if Sunday has maximum or near-maximum TOTAL staff
    sunday_count = all_day_counts.get("Sunday (2026-02-22)", 0)
    
    if sunday_count >= 7:  # Good staffing for high-traffic day (7 employees total with 5 shifts each)
        print(f"\n   ✅ PASS: Sunday has {sunday_count} total staff (prioritized as high-traffic day)")
    else:
        print(f"\n   ⚠️ Sunday has {sunday_count} total staff (expected 7+ for high-traffic day)")
else:
    print(f"   ❌ Schedule generation failed: {result2.get('error', 'unknown')}")

print("\n" + "="*80)
print("TEST COMPLETED")
print("="*80 + "\n")
