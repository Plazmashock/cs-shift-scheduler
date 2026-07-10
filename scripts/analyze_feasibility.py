#!/usr/bin/env python3
"""
Diagnostic tool for CS Scheduler to analyze feasibility.
"""

from scheduler import (
    build_shift_instances,
    SHIFT_DEFINITIONS,
    SHIFT_COMBINATIONS
)


def pattern_based_feasibility(min_staff_overrides: bool = True):
    """Analyze feasibility induced by the fixed weekly combination patterns.

    We use variables x1..x4 for number of employees assigned to each pattern.
    Current patterns (each employee works exactly 5 shifts):
        Combo 1: morning1 day1 afternoon1 night2  (S D M N) = (1,1,1,2)
        Combo 2: morning0 day2 afternoon2 night1              (0,2,2,1)
        Combo 3: morning1 day1 afternoon2 night1              (1,1,2,1)
        Combo 4: morning0 day2 afternoon1 night2              (0,2,1,2)

    Let total employees N = x1+x2+x3+x4.
    Weekly shift totals implied by patterns:
        Morning  S = x1 + x3 (must equal 7 because morning min=max=1 per day *7)
        Day      D = x1 + 2x2 + x3 + 2x4 = (x1 + x3) + 2(x2 + x4) = 7 + 2(N-7) = 2N - 7
        Afternoon   M = x1 + 2x2 + 2x3 + x4
        Night    Nn = 2x1 + x2 + x3 + 2x4

    Coverage requirements (weekly) with current SHIFT_DEFINITIONS:
        Morning: exactly 7
        Day:     14 – 21   (2-3 per day *7)
        Afternoon:  21 – 35   (3-5 per day *7)
        Night:   21 – 35   (3-5 per day *7)

    Immediate bound from Day total:
        14 ≤ 2N - 7 ≤ 21  =>  21 ≤ 2N ≤ 28  =>  10.5 ≤ N ≤ 14  =>  N ∈ {11,12,13,14}

    Morning constraint forces x1 + x3 = 7  (A)
    Let y = x2, z = x4, so y+z = N - 7. Also x3 = 7 - x1.

    Derive Afternoon and Night in terms of x1, y (since z = N-7 - y):
        M = x1 + 2y + 2(7 - x1) + z = 14 + 2y + z - x1
          = 14 + 2y + (N - 7 - y) - x1 = (N + 7) + (y - x1)
        Nn = 2x1 + y + (7 - x1) + 2z = 7 + x1 + y + 2(N - 7 - y)
           = (2N - 7) + (x1 - y)

    Afternoon min:  M ≥ 21  => (N + 7) + (y - x1) ≥ 21  => y - x1 ≥ 14 - N   ...(1)
    Night  min:  Nn ≥ 21 => (2N - 7) + (x1 - y) ≥ 21 => x1 - y ≥ 28 - 2N ...(2)

    Combine (1) & (2):  14 - N ≤ y - x1 ≤ 2N - 28  (after rearranging (2)).
    For a feasible integer interval we need: 14 - N ≤ 2N - 28  =>  42 ≤ 3N  => N ≥ 14.

    Also from earlier Day bound: N ≤ 14. Hence the ONLY feasible employee count under current
    patterns and shift minima is N = 14.

    When N = 14: inequalities give 0 ≤ y - x1 ≤ 0 => y = x1.
        Then x2 = x1, x3 = 7 - x1, x4 = 7 - x1.
        Afternoon total = 21 (exact minimum), Night total = 21 (exact minimum), Day total = 21 (exact maximum).
        Thus coverage is TIGHT: any attempt to lower a 2-night combo would violate night minimum.

    Conclusion: With current rules (afternoon & night min=3, day 2–3, morning fixed 1) the pattern system
    forces exactly 14 employees. 13 is infeasible despite aggregate slot math (65 ≥ 63) because patterns
    couple shift types making simultaneous afternoon & night minima impossible at N=13.
    "Random amounts per day" within min/max are restricted by these algebraic equalities.
    """

    print("\n=== Pattern-Based Feasibility (Current Combinations) ===")
    print("Employee counts potentially feasible from day constraint: 11,12,13,14")
    print("Testing each for simultaneous afternoon & night minima:")
    for N in [11,12,13,14,15]:
        day_total = 2*N - 7
        day_ok = 14 <= day_total <= 21
        # For N not meeting day bounds, immediately infeasible
        feasible = False
        reason = []
        if not day_ok:
            reason.append(f"day total {day_total} outside [14,21]")
        else:
            # Interval for (y - x1)
            lower = 14 - N
            upper = 2*N - 28
            if lower <= upper:
                feasible = True
                reason.append(f"y - x1 interval [{lower},{upper}] non-empty")
            else:
                reason.append(f"y - x1 interval empty ([{lower},{upper}])")
        status = "FEASIBLE" if feasible else "INFEASIBLE"
        print(f"N={N:2d}: {status} | day_total={day_total} | {'; '.join(reason)}")
    print("\nResult: Exactly N=14 employees required with current patterns + minima.")

def analyze_feasibility(week_start: str = "2025-10-06", num_employees: int = 8):
    """Analyze if the problem is feasible with given parameters."""
    
    print(f"=== Feasibility Analysis ===")
    print(f"Week start: {week_start}")
    print(f"Number of employees: {num_employees}")
    print()
    
    # Build shift instances
    shift_instances = build_shift_instances(week_start, days=7, timezone="UTC")
    
    # Count required slots per shift type
    shift_requirements = {}
    for si in shift_instances:
        if si.shift_type not in shift_requirements:
            shift_requirements[si.shift_type] = []
        shift_def = SHIFT_DEFINITIONS[si.shift_type]
        shift_requirements[si.shift_type].append((shift_def.min_staff, shift_def.max_staff))
    
    print("=== Shift Requirements (per day) ===")
    total_min_slots = 0
    total_max_slots = 0
    
    for shift_type, requirements in shift_requirements.items():
        min_per_day = requirements[0][0]  # All days have same requirements
        max_per_day = requirements[0][1]
        days = len(requirements)
        
        total_min_this_shift = min_per_day * days
        total_max_this_shift = max_per_day * days
        
        total_min_slots += total_min_this_shift
        total_max_slots += total_max_this_shift
        
        print(f"{shift_type:8}: {min_per_day}-{max_per_day} staff/day × {days} days = {total_min_this_shift}-{total_max_this_shift} total slots")
    
    print(f"\nTotal slots required: {total_min_slots}-{total_max_slots}")
    
    # Calculate available slots from employees
    total_employee_slots = num_employees * 5  # Each employee works 5 shifts
    print(f"Total employee slots available: {num_employees} employees × 5 shifts = {total_employee_slots}")
    
    print(f"\nFeasibility check:")
    if total_employee_slots < total_min_slots:
        print(f"❌ INFEASIBLE: Need at least {total_min_slots} slots, but only have {total_employee_slots}")
        print(f"   Minimum employees needed: {(total_min_slots + 4) // 5}")
    elif total_employee_slots > total_max_slots:
        print(f"❌ POTENTIALLY INFEASIBLE: Have {total_employee_slots} slots, but can use at most {total_max_slots}")
        print(f"   Maximum employees that can be usefully employed: {total_max_slots // 5}")
    else:
        print(f"✅ POTENTIALLY FEASIBLE: {total_min_slots} ≤ {total_employee_slots} ≤ {total_max_slots}")
    
    print()
    
    # Analyze flexible assignment (patterns removed)
    print("=== Flexible Assignment Analysis ===")
    print("Patterns removed - using flexible assignment with 5 shifts per employee")
    
    # Each employee gets exactly 5 shifts
    total_employee_shifts = num_employees * 5
    print(f"Total employee capacity: {total_employee_shifts} shifts")
    
    # Check against requirements
    print("\nCoverage feasibility:")
    for shift_type in SHIFT_DEFINITIONS.keys():
        shift_count = len([si for si in shift_instances if si.shift_type == shift_type])
        min_required = shift_count * SHIFT_DEFINITIONS[shift_type].min_staff
        max_allowed = shift_count * SHIFT_DEFINITIONS[shift_type].max_staff
        
        print(f"  {shift_type}: {shift_count} instances, need {min_required}-{max_allowed} total assignments")

    # Pattern-specific deeper feasibility (ignores rest constraints but captures structural limits)
    pattern_based_feasibility()

if __name__ == "__main__":
    print("Testing with 8 employees:")
    analyze_feasibility(num_employees=8)
    
    print("\n" + "="*60 + "\n")
    
    print("Testing with 10 employees:")
    analyze_feasibility(num_employees=10)
    
    print("\n" + "="*60 + "\n")
    
    print("Testing with 12 employees:")
    analyze_feasibility(num_employees=12)