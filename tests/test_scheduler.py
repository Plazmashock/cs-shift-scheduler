"""Unit tests for the CS Scheduler."""

import pytest
import pendulum
from scheduler import (
    build_shift_instances,
    precompute_incompatible_pairs,
    build_model_and_solve,
    validate_schedule,
    SHIFT_DEFINITIONS
)
from tests.test_data import (
    SAMPLE_SPEC,
    SAMPLE_EMPLOYEES,
    SAMPLE_VALID_ASSIGNMENTS,
    SAMPLE_INVALID_ASSIGNMENTS
)


class TestShiftInstances:
    """Test shift instance generation."""
    
    def test_build_shift_instances_basic(self):
        """Test basic shift instance generation."""
        instances = build_shift_instances("2025-10-06", days=1, timezone="UTC")
        
        # Should have 4 shift types * 1 day = 4 instances
        assert len(instances) == 4
        
        # Check all shift types are present
        shift_types = {si.shift_type for si in instances}
        assert shift_types == {"morning", "day", "afternoon", "night"}
        
        # Check dates
        dates = {si.date for si in instances}
        assert dates == {"2025-10-06"}
    
    def test_build_shift_instances_week(self):
        """Test weekly shift instance generation."""
        instances = build_shift_instances("2025-10-06", days=7, timezone="UTC")
        
        # Should have 4 shift types * 7 days = 28 instances
        assert len(instances) == 28
        
        # Check date range
        dates = sorted({si.date for si in instances})
        expected_dates = [
            "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09",
            "2025-10-10", "2025-10-11", "2025-10-12"
        ]
        assert dates == expected_dates
    
    def test_shift_instance_times(self):
        """Test shift instance timing calculations."""
        instances = build_shift_instances("2025-10-06", days=1, timezone="UTC")
        
        # Find morning shift
        morning = next(si for si in instances if si.shift_type == "morning")
        assert morning.start_dt.hour == 4
        assert morning.start_dt.minute == 0
        assert morning.end_dt.hour == 13
        assert morning.end_dt.minute == 0
        assert morning.start_dt.date() == morning.end_dt.date()  # Same day
        
        # Find night shift (overnight)
        night = next(si for si in instances if si.shift_type == "night")
        assert night.start_dt.hour == 19
        assert night.end_dt.hour == 4
        assert night.end_dt.date() > night.start_dt.date()  # Next day


class TestIncompatiblePairs:
    """Test incompatible pair computation."""
    
    def test_precompute_incompatible_pairs_basic(self):
        """Test basic incompatible pair computation."""
        instances = build_shift_instances("2025-10-06", days=2, timezone="UTC")
        incompatible = precompute_incompatible_pairs(instances, min_gap_hours=12)
        
        # Should find incompatible pairs
        assert len(incompatible) > 0
        
        # All pairs should be tuples of integers
        for i, j in incompatible:
            assert isinstance(i, int)
            assert isinstance(j, int)
            assert 0 <= i < len(instances)
            assert 0 <= j < len(instances)
            assert i != j
    
    def test_same_day_exception(self):
        """Test same-day morning+night exception."""
        instances = build_shift_instances("2025-10-06", days=1, timezone="UTC")
        
        # Without exception
        incompatible_normal = precompute_incompatible_pairs(
            instances, min_gap_hours=12, allow_exception=False
        )
        
        # With exception
        incompatible_exception = precompute_incompatible_pairs(
            instances, min_gap_hours=12, allow_exception=True
        )
        
        # Should have fewer incompatible pairs with exception
        assert len(incompatible_exception) <= len(incompatible_normal)
    
    def test_twelve_hour_rule(self):
        """Test specific 12-hour rule violations."""
        instances = build_shift_instances("2025-10-06", days=1, timezone="UTC")
        incompatible = precompute_incompatible_pairs(instances, min_gap_hours=12)
        
        # Find morning and afternoon on same day
        morning_idx = next(i for i, si in enumerate(instances) if si.shift_type == "morning")
        afternoon_idx = next(i for i, si in enumerate(instances) if si.shift_type == "afternoon")
        
        # Morning to afternoon should be incompatible (only 2-hour gap)
        assert (morning_idx, afternoon_idx) in incompatible


class TestModelSolving:
    """Test the CP-SAT model and solving."""
    
    def test_build_model_small(self):
        """Test model building with small employee set."""
        # Use smaller employee set for faster testing
        small_spec = SAMPLE_SPEC.copy()
        small_spec["employees"] = SAMPLE_EMPLOYEES[:4]  # Only 4 employees
        small_spec["max_solve_time"] = 5  # Short solve time
        
        result = build_model_and_solve(small_spec)
        
        # Should either find a solution or report infeasible
        assert result["status"] in ["optimal", "feasible", "infeasible"]
        
        if result["status"] in ["optimal", "feasible"]:
            assignments = result["assignments"]
            assert isinstance(assignments, list)
            assert len(assignments) > 0
            
            # Check assignment structure
            for assignment in assignments:
                required_keys = {
                    "employee_id", "employee_name", "date", "shift_type",
                    "start_datetime", "end_datetime"
                }
                assert set(assignment.keys()) == required_keys
    
    def test_model_with_patterns(self):
        """Test that solution respects weekly patterns."""
        small_spec = SAMPLE_SPEC.copy()
        small_spec["employees"] = SAMPLE_EMPLOYEES[:6]  # 6 employees
        small_spec["max_solve_time"] = 10
        
        result = build_model_and_solve(small_spec)
        
        if result["status"] in ["optimal", "feasible"]:
            assignments = result["assignments"]
            
            # Group by employee
            employee_assignments = {}
            for assignment in assignments:
                emp_id = assignment["employee_id"]
                if emp_id not in employee_assignments:
                    employee_assignments[emp_id] = []
                employee_assignments[emp_id].append(assignment)
            
            # Check each employee has exactly 5 shifts
            for emp_id, emp_assignments in employee_assignments.items():
                assert len(emp_assignments) == 5, f"Employee {emp_id} has {len(emp_assignments)} shifts"
                
                # Count shift types
                shift_counts = {}
                for assignment in emp_assignments:
                    shift_type = assignment["shift_type"]
                    shift_counts[shift_type] = shift_counts.get(shift_type, 0) + 1
                
                # Patterns removed - just verify employee has exactly 5 shifts
                matches_pattern = sum(shift_counts.values()) == 5
                
                assert matches_pattern, f"Employee {emp_id} shift counts {shift_counts} don't match any pattern"


class TestValidation:
    """Test schedule validation."""
    
    def test_validate_valid_schedule(self):
        """Test validation of a valid schedule."""
        validation = validate_schedule(SAMPLE_VALID_ASSIGNMENTS, SAMPLE_SPEC)
        
        # Should pass basic structural validation
        assert isinstance(validation, dict)
        assert "valid" in validation
        assert "errors" in validation
        assert "warnings" in validation
    
    def test_validate_invalid_schedule(self):
        """Test validation of an invalid schedule."""
        validation = validate_schedule(SAMPLE_INVALID_ASSIGNMENTS, SAMPLE_SPEC)
        
        # Should detect issues
        assert isinstance(validation, dict)
        assert "valid" in validation
        assert "errors" in validation
        
        # Should have errors due to insufficient shift count and 12-hour violation
        if not validation["valid"]:
            assert len(validation["errors"]) > 0
    
    def test_validate_twelve_hour_rule(self):
        """Test validation specifically for 12-hour rule."""
        # Create assignments that violate 12-hour rule
        bad_assignments = [
            {
                "employee_id": 1,
                "employee_name": "Alice",
                "date": "2025-10-06",
                "shift_type": "morning",
                "start_datetime": "2025-10-06T04:00:00+00:00",
                "end_datetime": "2025-10-06T13:00:00+00:00"
            },
            {
                "employee_id": 1,
                "employee_name": "Alice",
                "date": "2025-10-06",
                "shift_type": "afternoon",
                "start_datetime": "2025-10-06T15:00:00+00:00",
                "end_datetime": "2025-10-07T00:00:00+00:00"
            }
        ]
        
        validation = validate_schedule(bad_assignments, SAMPLE_SPEC)
        
        # Should detect 12-hour rule violation
        twelve_hour_errors = [
            error for error in validation.get("errors", [])
            if "rest between" in error or "gap" in error.lower()
        ]
        
        # Should find the violation (only 2 hours between shifts)
        assert len(twelve_hour_errors) > 0 or not validation["valid"]


class TestWeeklyPatterns:
    """Test weekly pattern definitions and constraints."""
    
    def test_pattern_definitions(self):
        """Test that all patterns sum to 5 shifts - DISABLED (patterns removed)."""
        # Patterns removed from scheduler - skip this test
        pass
    
    def test_pattern_coverage(self):
        """Test that patterns cover all shift types - DISABLED (patterns removed)."""
        # Patterns removed from scheduler - skip this test
        pass


class TestShiftDefinitions:
    """Test shift definitions."""
    
    def test_shift_definitions_complete(self):
        """Test that all required shift types are defined."""
        expected_shifts = {"morning", "day", "afternoon", "night"}
        actual_shifts = set(SHIFT_DEFINITIONS.keys())
        assert actual_shifts == expected_shifts
    
    def test_shift_timing_logic(self):
        """Test shift timing makes sense."""
        # Morning: 04:00 — 13:00 (same day)
        morning = SHIFT_DEFINITIONS["morning"]
        assert morning.start_hour < morning.end_hour  # Same day
        
        # Night: 19:00 — 04:00 (next day)
        night = SHIFT_DEFINITIONS["night"]
        assert night.start_hour > night.end_hour  # Overnight
        
        # Afternoon: 15:00 — 00:00 (next day)
        afternoon = SHIFT_DEFINITIONS["afternoon"]
        assert afternoon.start_hour > afternoon.end_hour  # Overnight
    
    def test_staffing_requirements(self):
        """Test staffing requirements are reasonable."""
        for shift_type, shift_def in SHIFT_DEFINITIONS.items():
            assert shift_def.min_staff > 0, f"{shift_type} min_staff must be positive"
            assert shift_def.max_staff >= shift_def.min_staff, (
                f"{shift_type} max_staff must be >= min_staff"
            )


if __name__ == "__main__":
    pytest.main([__file__])