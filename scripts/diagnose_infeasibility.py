#!/usr/bin/env python3
"""
Diagnostic script to analyze exactly why the schedule is infeasible.
This will show step-by-step which constraints are problematic.
"""

from scheduler import *
import logging

# Set up detailed logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def analyze_infeasibility():
    """Analyze exactly why the schedule is infeasible"""
    
    # Test with 13 employees
    employees_data = [
        {"id": i, "name": f"Employee_{i}"} for i in range(1, 14)
    ]
    
    spec = {
        "week_start": "2025-10-06",
        "employees": employees_data,
        "timezone": "UTC",
        "allow_same_day_morning_night_exception": False,
        "max_solve_time": 30
    }
    
    print("🔍 ANALYZING SCHEDULE INFEASIBILITY")
    print("=" * 50)
    
    # Step 1: Build shift instances
    print("\n📅 Step 1: Shift Instances")
    week_start = spec["week_start"]
    shift_instances = build_shift_instances(week_start, 7, spec.get("timezone", "UTC"))
    
    print(f"Total shift instances: {len(shift_instances)}")
    for shift_type in ['morning', 'day', 'afternoon', 'night']:
        count = len([si for si in shift_instances if si.shift_type == shift_type])
        print(f"  {shift_type}: {count} shifts")
    
    # Step 2: Coverage requirements
    print("\n👥 Step 2: Coverage Requirements")
    total_min_coverage = 0
    total_max_coverage = 0
    
    for shift_type, shift_def in SHIFT_DEFINITIONS.items():
        instances = [si for si in shift_instances if si.shift_type == shift_type]
        min_total = len(instances) * shift_def.min_staff
        max_total = len(instances) * shift_def.max_staff
        total_min_coverage += min_total
        total_max_coverage += max_total
        print(f"  {shift_type}: {len(instances)} shifts × {shift_def.min_staff}-{shift_def.max_staff} staff = {min_total}-{max_total} slots")
    
    print(f"\nTotal coverage needed: {total_min_coverage}-{total_max_coverage} slots")
    
    # Step 3: Employee capacity
    print("\n👤 Step 3: Employee Capacity")
    num_employees = len(employees_data)
    total_employee_slots = num_employees * 5  # 5 shifts per person
    print(f"Available capacity: {num_employees} employees × 5 shifts = {total_employee_slots} slots")
    
    if total_employee_slots < total_min_coverage:
        print(f"❌ INSUFFICIENT CAPACITY: Need {total_min_coverage} but only have {total_employee_slots}")
        return
    else:
        print(f"✅ SUFFICIENT CAPACITY: {total_employee_slots} >= {total_min_coverage}")
    
    # Step 4: 12-hour rest conflicts
    print("\n⏰ Step 4: 12-Hour Rest Conflicts")
    incompatible_pairs = precompute_incompatible_pairs(
        shift_instances, 
        min_gap_hours=12, 
        allow_exception=spec.get("allow_same_day_morning_night_exception", False)
    )
    
    print(f"Total incompatible shift pairs: {len(incompatible_pairs)}")
    
    # Analyze conflicts by shift type pairs
    conflict_analysis = {}
    for i, j in incompatible_pairs:
        shift_i = shift_instances[i]
        shift_j = shift_instances[j]
        
        pair_key = f"{shift_i.shift_type} → {shift_j.shift_type}"
        if pair_key not in conflict_analysis:
            conflict_analysis[pair_key] = 0
        conflict_analysis[pair_key] += 1
    
    print("Conflicts by shift type pairs:")
    for pair, count in sorted(conflict_analysis.items()):
        print(f"  {pair}: {count} conflicts")
    
    # Step 5: Detailed shift timing analysis
    print("\n🕒 Step 5: Shift Timing Analysis")
    print("Shift definitions:")
    for shift_type, shift_def in SHIFT_DEFINITIONS.items():
        print(f"  {shift_type}: {shift_def.start_hour:02d}:00 - {shift_def.end_hour:02d}:00")
    
    print("\nDaily shift overlaps:")
    for day in range(7):
        print(f"\nDay {day + 1}:")
        day_shifts = [si for si in shift_instances if si.date == shift_instances[0].start_dt.date().add(days=day)]
        
        for si in day_shifts:
            conflicts_from_this = [j for i, j in incompatible_pairs if i == si.index]
            conflicts_to_this = [i for i, j in incompatible_pairs if j == si.index]
            total_conflicts = len(set(conflicts_from_this + conflicts_to_this))
            
            print(f"    {si.shift_type}: {total_conflicts} total conflicts")
    
    # Step 6: Mathematical feasibility check
    print("\n🧮 Step 6: Mathematical Feasibility")
    
    # Check if it's mathematically possible to assign shifts without conflicts
    # This is a simplified check - the actual CP-SAT has more complex constraints
    
    print("\nSimplified conflict analysis:")
    print("If every employee must work exactly 5 shifts, and no two conflicting")
    print("shifts can be assigned to the same person, we need to check if")
    print("the conflict graph allows a valid assignment.")
    
    # Count maximum conflicts per shift
    max_conflicts_per_shift = 0
    for si in shift_instances:
        conflicts_from = len([j for i, j in incompatible_pairs if i == si.index])
        conflicts_to = len([i for i, j in incompatible_pairs if j == si.index])
        total_conflicts = len(set([j for i, j in incompatible_pairs if i == si.index] + 
                                [i for i, j in incompatible_pairs if j == si.index]))
        max_conflicts_per_shift = max(max_conflicts_per_shift, total_conflicts)
    
    print(f"Maximum conflicts for any single shift: {max_conflicts_per_shift}")
    print(f"Total shifts: {len(shift_instances)}")
    print(f"If every shift conflicts with {max_conflicts_per_shift} others, we need enough")
    print(f"'independent' shifts that don't conflict with each other.")
    
    print(f"\n📊 SUMMARY:")
    print(f"  • {num_employees} employees × 5 shifts = {total_employee_slots} total capacity")
    print(f"  • Need {total_min_coverage}-{total_max_coverage} shifts for coverage")
    print(f"  • {len(incompatible_pairs)} incompatible pairs due to 12-hour rule")
    print(f"  • Capacity sufficient: {'✅' if total_employee_slots >= total_min_coverage else '❌'}")
    
    if len(incompatible_pairs) > 0:
        print(f"  • 12-hour rest creates {len(incompatible_pairs)} conflicts")
        print(f"  • The constraint solver cannot find a way to assign shifts")
        print(f"    that satisfies both coverage AND rest requirements")

if __name__ == "__main__":
    analyze_infeasibility()