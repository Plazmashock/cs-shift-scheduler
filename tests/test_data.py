"""Test data fixtures for scheduler tests."""

import pendulum

# Sample employee data
SAMPLE_EMPLOYEES = [
    {"id": 1, "name": "Alice"},
    {"id": 2, "name": "Bob"},
    {"id": 3, "name": "Charlie"},
    {"id": 4, "name": "Diana"},
    {"id": 5, "name": "Eve"},
    {"id": 6, "name": "Frank"},
    {"id": 7, "name": "Grace"},
    {"id": 8, "name": "Henry"},
]

# Sample specification for testing
SAMPLE_SPEC = {
    "week_start": "2025-10-06",  # Monday
    "employees": SAMPLE_EMPLOYEES,
    "timezone": "UTC",
    "allow_same_day_morning_night_exception": False,
    "max_solve_time": 10  # Shorter time for tests
}

# Sample valid assignments for validation testing
SAMPLE_VALID_ASSIGNMENTS = [
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
        "date": "2025-10-07",
        "shift_type": "day",
        "start_datetime": "2025-10-07T10:00:00+00:00",
        "end_datetime": "2025-10-07T19:00:00+00:00"
    },
    {
        "employee_id": 1,
        "employee_name": "Alice",
        "date": "2025-10-08",
        "shift_type": "night",
        "start_datetime": "2025-10-08T19:00:00+00:00",
        "end_datetime": "2025-10-09T04:00:00+00:00"
    },
    {
        "employee_id": 1,
        "employee_name": "Alice",
        "date": "2025-10-10",
        "shift_type": "night",
        "start_datetime": "2025-10-10T19:00:00+00:00",
        "end_datetime": "2025-10-11T04:00:00+00:00"
    },
    {
        "employee_id": 1,
        "employee_name": "Alice",
        "date": "2025-10-12",
        "shift_type": "afternoon",
        "start_datetime": "2025-10-12T15:00:00+00:00",
        "end_datetime": "2025-10-13T00:00:00+00:00"
    }
]

# Sample invalid assignments (violates 12-hour rule)
SAMPLE_INVALID_ASSIGNMENTS = [
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
        "shift_type": "afternoon",  # Only 2 hours after morning ends
        "start_datetime": "2025-10-06T15:00:00+00:00",
        "end_datetime": "2025-10-07T00:00:00+00:00"
    }
]