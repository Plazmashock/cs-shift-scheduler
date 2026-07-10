#!/usr/bin/env python3
"""
Acceptance tests for POST /api/labor-report/worklog

Covers:
  1. Invalid secret → 403
  2. Missing secret header → 401
  3. Cross-midnight night shift counted on shift start date
  4. Multiple same-day shifts aggregate into one row
  5. No-data month returns 200 with empty days list
  6. employee_email lookup (resolved to employee_id)
"""

import os
import sys
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ── Env setup before any app import ─────────────────────────────────────────
os.environ['WEBHOOK_SECRET'] = 'test-secret-xyz'

# ── Stub out firebase_admin so api_fastapi.py can be imported without creds ─
_firebase_stub = MagicMock()
# Make _apps falsy so the `if not firebase_admin._apps:` init block is skipped
_firebase_stub._apps = {}         # empty dict → falsy (bool({})==False)

sys.modules.setdefault('firebase_admin', _firebase_stub)
sys.modules.setdefault('firebase_admin.auth', _firebase_stub.auth)
sys.modules.setdefault('firebase_admin.credentials', _firebase_stub.credentials)
sys.modules.setdefault('firebase_admin.db', _firebase_stub.db)

# Add the functions directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'functions'))

from fastapi.testclient import TestClient  # noqa: E402 — must come after sys.modules setup

from api_fastapi import (  # noqa: E402
    app,
    _night_overlap_hours,
    _compute_shift_hours_breakdown,
)

client = TestClient(app, raise_server_exceptions=True)

SECRET = 'test-secret-xyz'
VALID_HEADERS = {'X-Webhook-Secret': SECRET}
URL = '/api/labor-report/worklog'

# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_assignment(
    employee_id: int,
    date: str,
    shift_type: str,
    start_datetime: str,
    end_datetime: str,
) -> dict:
    return {
        'employee_id': employee_id,
        'employee_name': f'Employee {employee_id}',
        'date': date,
        'shift_type': shift_type,
        'start_datetime': start_datetime,
        'end_datetime': end_datetime,
    }


def _mock_db_for_weeks(week_data: dict):
    """
    Return a context manager that patches firebase_admin.db.reference so
    that `db.reference(f'schedules/{week}').get()` returns the matching entry
    from week_data, and teamMembers returns an empty dict.
    """
    def _reference(path: str):
        ref = MagicMock()
        if path.startswith('schedules/'):
            week = path.split('schedules/')[1].rstrip('/')
            ref.get.return_value = week_data.get(week, {})
        elif path == 'teamMembers':
            ref.get.return_value = {}
        else:
            ref.get.return_value = None
        return ref

    return patch('api_fastapi.db.reference', side_effect=_reference)


# ════════════════════════════════════════════════════════════════════════════
# Unit tests for helper functions
# ════════════════════════════════════════════════════════════════════════════

class TestNightOverlapHours:
    """Tests for _night_overlap_hours()."""

    def test_day_shift_no_night(self):
        """Day shift 10:00–19:00 has zero night hours."""
        import pendulum
        start = pendulum.datetime(2026, 5, 5, 10, 0, tz='Asia/Tbilisi')
        end   = pendulum.datetime(2026, 5, 5, 19, 0, tz='Asia/Tbilisi')
        assert _night_overlap_hours(start, end) == 0.0

    def test_morning_shift_night_hours(self):
        """Morning shift 04:00–13:00 overlaps with 04:00–06:00 → 2 h night."""
        import pendulum
        start = pendulum.datetime(2026, 5, 5, 4, 0, tz='Asia/Tbilisi')
        end   = pendulum.datetime(2026, 5, 5, 13, 0, tz='Asia/Tbilisi')
        assert _night_overlap_hours(start, end) == pytest.approx(2.0)

    def test_afternoon_shift_night_hours(self):
        """Afternoon shift 15:00–00:00 overlaps with 22:00–00:00 → 2 h night."""
        import pendulum
        start = pendulum.datetime(2026, 5, 5, 15, 0, tz='Asia/Tbilisi')
        end   = pendulum.datetime(2026, 5, 6,  0, 0, tz='Asia/Tbilisi')
        assert _night_overlap_hours(start, end) == pytest.approx(2.0)

    def test_night_shift_night_hours_cross_midnight(self):
        """Night shift 19:00–04:00 crosses midnight: 22:00–04:00 → 6 h night."""
        import pendulum
        start = pendulum.datetime(2026, 5, 5, 19, 0, tz='Asia/Tbilisi')
        end   = pendulum.datetime(2026, 5, 6,  4, 0, tz='Asia/Tbilisi')
        assert _night_overlap_hours(start, end) == pytest.approx(6.0)


class TestComputeShiftHoursBreakdown:
    """Tests for _compute_shift_hours_breakdown()."""

    def test_night_shift_with_datetimes(self):
        """Night shift from stored ISO datetimes produces 9 h worked, 6 h night."""
        assignment = _make_assignment(
            1, '2026-05-05', 'night',
            '2026-05-05T19:00:00+04:00',
            '2026-05-06T04:00:00+04:00',
        )
        worked, night = _compute_shift_hours_breakdown(assignment)
        assert worked == pytest.approx(8.0)
        assert night  == pytest.approx(6.0)

    def test_morning_shift_fallback_no_datetimes(self):
        """When datetimes are absent, falls back to pre-computed constants."""
        assignment = {'shift_type': 'morning', 'employee_id': 1, 'date': '2026-05-05'}
        worked, night = _compute_shift_hours_breakdown(assignment)
        assert worked == pytest.approx(8.0)
        assert night  == pytest.approx(2.0)

    def test_day_shift_fallback(self):
        assignment = {'shift_type': 'day', 'employee_id': 1, 'date': '2026-05-05'}
        worked, night = _compute_shift_hours_breakdown(assignment)
        assert worked == pytest.approx(8.0)
        assert night  == pytest.approx(0.0)


# ════════════════════════════════════════════════════════════════════════════
# Integration tests for the endpoint
# ════════════════════════════════════════════════════════════════════════════

class TestLaborReportAuth:
    """Authentication edge cases."""

    def test_missing_secret_header_returns_401(self):
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        resp = client.post(URL, json=payload)
        assert resp.status_code == 401

    def test_wrong_secret_returns_403(self):
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        resp = client.post(URL, json=payload, headers={'X-Webhook-Secret': 'WRONG'})
        assert resp.status_code == 403

    def test_valid_secret_passes_auth(self):
        """A valid secret with no data in Firebase should return 200 + rest-day entries for each day."""
        payload = {'employee_id': '999', 'year': 2026, 'month': 1}
        with _mock_db_for_weeks({}):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body['days']) == 31  # January has 31 days
        assert all(d['is_rest_day'] is True for d in body['days'])
        assert all(d['worked_hours'] == 0.0 for d in body['days'])


class TestLaborReportNoData:
    """No-data scenarios."""

    def test_employee_with_no_shifts_in_month_returns_rest_days(self):
        """Employee exists but has no assignments in the queried month → all rest days."""
        week_data = {
            '2026-04-27': {'assignments': [
                _make_assignment(
                    5, '2026-04-28', 'day',
                    '2026-04-28T10:00:00+04:00',
                    '2026-04-28T19:00:00+04:00',
                )
            ]},
        }
        payload = {'employee_id': '5', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body['days']) == 31  # May has 31 days
        assert all(d['is_rest_day'] is True for d in body['days'])
        assert all(d['worked_hours'] == 0.0 for d in body['days'])

    def test_unknown_employee_email_returns_empty_days(self):
        """Email not found in teamMembers → 200 with empty days."""
        def _reference(path: str):
            ref = MagicMock()
            if path == 'teamMembers':
                ref.get.return_value = {
                    '1': {'id': 1, 'email': 'other@example.com', 'name': 'Other'}
                }
            else:
                ref.get.return_value = {}
            return ref

        payload = {'employee_email': 'nobody@example.com', 'year': 2026, 'month': 5}
        with patch('api_fastapi.db.reference', side_effect=_reference):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        assert resp.status_code == 200
        assert resp.json() == {'days': []}


class TestLaborReportCrossMiddnight:
    """Acceptance test: cross-midnight night shift credited to shift start date."""

    def test_night_shift_credited_to_start_date_not_end_date(self):
        """
        Night shift: date='2026-05-31', start 19:00, end 04:00 next day.
        Must appear in May 2026 result under '2026-05-31', NOT June.
        """
        assignment = _make_assignment(
            1, '2026-05-31', 'night',
            '2026-05-31T19:00:00+04:00',
            '2026-06-01T04:00:00+04:00',
        )
        week_data = {
            '2026-05-25': {'assignments': [assignment]},
        }
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        days = resp.json()['days']
        assert len(days) == 31  # all May days returned
        worked_days = [d for d in days if not d['is_rest_day']]
        assert len(worked_days) == 1, f'Expected 1 worked day row, got {worked_days}'
        row = worked_days[0]
        assert row['date'] == '2026-05-31'
        assert row['worked_hours'] == pytest.approx(8.0)
        assert row['night_hours']  == pytest.approx(6.0)
        assert row['day_hours']    == pytest.approx(2.0)

    def test_end_date_of_cross_midnight_shift_excluded_from_next_month(self):
        """
        The end date (June 1st) of a May 31st night shift must NOT appear as a
        June row when querying June.
        """
        assignment = _make_assignment(
            1, '2026-05-31', 'night',
            '2026-05-31T19:00:00+04:00',
            '2026-06-01T04:00:00+04:00',
        )
        week_data = {
            '2026-05-25': {'assignments': [assignment]},
        }
        payload = {'employee_id': '1', 'year': 2026, 'month': 6}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        days = resp.json()['days']
        # The shift's `date` is May 31 → must NOT appear in June results
        assert all(d['date'].startswith('2026-06') for d in days)
        may31_rows = [d for d in days if d['date'] == '2026-05-31']
        assert len(may31_rows) == 0


class TestLaborReportAggregation:
    """Multiple shifts on the same day must aggregate into a single row."""

    def test_multiple_shifts_same_day_aggregate(self):
        """
        An employee works a regular day shift AND an overtime block on the same
        date.  Both should collapse into one row with summed hours.
        """
        day_shift = _make_assignment(
            2, '2026-05-10', 'day',
            '2026-05-10T10:00:00+04:00',
            '2026-05-10T19:00:00+04:00',
        )
        overtime_shift = {
            'employee_id': 2,
            'employee_name': 'Employee 2',
            'date': '2026-05-10',
            'shift_type': 'overtime',
            'duration_hours': 2.0,
            'start_datetime': '2026-05-10T19:00:00+04:00',
            'end_datetime': '2026-05-10T21:00:00+04:00',
        }
        week_data = {
            '2026-05-04': {'assignments': [day_shift, overtime_shift]},
        }
        payload = {'employee_id': '2', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        days = resp.json()['days']
        worked_days = [d for d in days if not d['is_rest_day']]
        assert len(worked_days) == 1, f'Expected 1 aggregated row, got {worked_days}'
        row = worked_days[0]
        assert row['date'] == '2026-05-10'
        assert row['worked_hours']   == pytest.approx(10.0)  # 8 + 2
        assert row['overtime_hours'] == pytest.approx(2.0)
        assert row['day_hours']      == pytest.approx(8.0)   # 8 day + 0 night for day shift

    def test_two_standard_shifts_on_same_day_aggregate(self):
        """Two morning shifts for the same employee/date sum their hours."""
        s1 = _make_assignment(
            3, '2026-05-15', 'morning',
            '2026-05-15T04:00:00+04:00',
            '2026-05-15T13:00:00+04:00',
        )
        s2 = _make_assignment(
            3, '2026-05-15', 'morning',
            '2026-05-15T04:00:00+04:00',
            '2026-05-15T13:00:00+04:00',
        )
        week_data = {
            '2026-05-11': {'assignments': [s1, s2]},
        }
        payload = {'employee_id': '3', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        days = resp.json()['days']
        worked_days = [d for d in days if not d['is_rest_day']]
        assert len(worked_days) == 1
        row = worked_days[0]
        assert row['worked_hours'] == pytest.approx(16.0)   # 8 + 8
        assert row['night_hours']  == pytest.approx(4.0)    # 2 + 2


class TestLaborReportEmailLookup:
    """employee_email resolves to employee_id via teamMembers."""

    def test_lookup_by_email_finds_employee(self):
        def _reference(path: str):
            ref = MagicMock()
            if path == 'teamMembers':
                ref.get.return_value = {
                    '1': {'id': 7, 'email': 'tester@example.com', 'name': 'Tester'}
                }
            elif path.startswith('schedules/'):
                week = path.split('schedules/')[1]
                if week == '2026-04-27':
                    ref.get.return_value = {
                        'assignments': [
                            _make_assignment(
                                7, '2026-05-01', 'day',
                                '2026-05-01T10:00:00+04:00',
                                '2026-05-01T19:00:00+04:00',
                            )
                        ]
                    }
                else:
                    ref.get.return_value = {}
            else:
                ref.get.return_value = None
            return ref

        payload = {'employee_email': 'tester@example.com', 'year': 2026, 'month': 5}
        with patch('api_fastapi.db.reference', side_effect=_reference):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        days = resp.json()['days']
        worked_days = [d for d in days if not d['is_rest_day']]
        assert len(worked_days) == 1
        assert worked_days[0]['date'] == '2026-05-01'
        assert worked_days[0]['worked_hours'] == pytest.approx(8.0)


class TestLaborReportResponseShape:
    """Response shape and field types are stable."""

    def test_response_fields_are_numeric_not_strings(self):
        assignment = _make_assignment(
            10, '2026-05-05', 'night',
            '2026-05-05T19:00:00+04:00',
            '2026-05-06T04:00:00+04:00',
        )
        week_data = {'2026-04-27': {'assignments': [assignment]}}
        payload = {'employee_id': '10', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        assert resp.status_code == 200
        all_days = resp.json()['days']
        worked_days = [d for d in all_days if not d['is_rest_day']]
        assert len(worked_days) == 1
        row = worked_days[0]
        numeric_fields = [
            'worked_hours', 'day_hours', 'night_hours',
            'overtime_hours', 'rest_holiday_worked_hours', 'other_worked_hours',
        ]
        for field in numeric_fields:
            assert isinstance(row[field], (int, float)), (
                f'{field} must be numeric, got {type(row[field])}'
            )

    def test_response_contains_days_key(self):
        payload = {'employee_id': '1', 'year': 2026, 'month': 1}
        with _mock_db_for_weeks({}):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        assert 'days' in resp.json()
        assert isinstance(resp.json()['days'], list)

    def test_days_sorted_by_date(self):
        """Returned rows must be in ascending date order."""
        assignments = [
            _make_assignment(1, f'2026-05-{d:02d}', 'day',
                             f'2026-05-{d:02d}T10:00:00+04:00',
                             f'2026-05-{d:02d}T19:00:00+04:00')
            for d in [20, 5, 12]   # intentionally unordered
        ]
        week_data = {
            '2026-04-27': {'assignments': [assignments[1]]},  # May 5
            '2026-05-11': {'assignments': [assignments[2]]},  # May 12
            '2026-05-18': {'assignments': [assignments[0]]},  # May 20
        }
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)

        dates = [row['date'] for row in resp.json()['days']]
        assert dates == sorted(dates)


# ════════════════════════════════════════════════════════════════════════════
# Leave hours tests
# ════════════════════════════════════════════════════════════════════════════

def _make_leave(employee_id: int, date: str, shift_type: str, timeframe: str,
                shift_start: str, shift_end: str,
                custom_start: str = '', custom_end: str = '') -> dict:
    return {
        'employee_id': employee_id,
        'date': date,
        'shift_type': shift_type,
        'timeframe': timeframe,
        'shift_start': shift_start,
        'shift_end': shift_end,
        'custom_start': custom_start,
        'custom_end': custom_end,
    }


class TestLeaveHours:
    """Leave hours appear in every response row with correct day/night split."""

    def test_rest_day_has_zero_leave_fields(self):
        """A calendar day with no shifts and no leave returns zero leave fields."""
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks({}):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = resp.json()['days'][0]  # any rest day
        assert row['leave_hours'] == 0.0
        assert row['day_leave_hours'] == 0.0
        assert row['night_leave_hours'] == 0.0

    def test_all_day_leave_on_day_shift(self):
        """All-day leave on day shift (10:00–19:00): 8h leave, 0h night leave."""
        assignment = _make_assignment(1, '2026-05-07', 'day',
                                      '2026-05-07T10:00:00+04:00',
                                      '2026-05-07T19:00:00+04:00')
        leave = _make_leave(1, '2026-05-07', 'day', 'all-day',
                            '2026-05-07T10:00:00+04:00',
                            '2026-05-07T19:00:00+04:00')
        week_data = {'2026-05-04': {'assignments': [assignment], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '1', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-07')
        assert row['leave_hours']       == pytest.approx(8.0)
        assert row['night_leave_hours'] == pytest.approx(0.0)
        assert row['day_leave_hours']   == pytest.approx(8.0)

    def test_all_day_leave_on_night_shift(self):
        """All-day leave on night shift (19:00–04:00): 8h leave, 6h night leave."""
        assignment = _make_assignment(2, '2026-05-10', 'night',
                                      '2026-05-10T19:00:00+04:00',
                                      '2026-05-11T04:00:00+04:00')
        leave = _make_leave(2, '2026-05-10', 'night', 'all-day',
                            '2026-05-10T19:00:00+04:00',
                            '2026-05-11T04:00:00+04:00')
        week_data = {'2026-05-04': {'assignments': [assignment], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '2', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-10')
        assert row['leave_hours']       == pytest.approx(8.0)
        assert row['night_leave_hours'] == pytest.approx(6.0)
        assert row['day_leave_hours']   == pytest.approx(2.0)

    def test_all_day_leave_on_morning_shift(self):
        """All-day leave on morning shift (04:00–13:00): 8h leave, 2h night leave."""
        assignment = _make_assignment(3, '2026-05-12', 'morning',
                                      '2026-05-12T04:00:00+04:00',
                                      '2026-05-12T13:00:00+04:00')
        leave = _make_leave(3, '2026-05-12', 'morning', 'all-day',
                            '2026-05-12T04:00:00+04:00',
                            '2026-05-12T13:00:00+04:00')
        week_data = {'2026-05-11': {'assignments': [assignment], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '3', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-12')
        assert row['leave_hours']       == pytest.approx(8.0)
        assert row['night_leave_hours'] == pytest.approx(2.0)
        assert row['day_leave_hours']   == pytest.approx(6.0)

    def test_first_half_leave_on_day_shift(self):
        """First-half leave on day shift: 4h leave, 0h night leave."""
        assignment = _make_assignment(4, '2026-05-05', 'day',
                                      '2026-05-05T10:00:00+04:00',
                                      '2026-05-05T19:00:00+04:00')
        leave = _make_leave(4, '2026-05-05', 'day', 'first-half',
                            '2026-05-05T10:00:00+04:00',
                            '2026-05-05T19:00:00+04:00')
        week_data = {'2026-05-04': {'assignments': [assignment], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '4', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-05')
        assert row['leave_hours']       == pytest.approx(4.0)
        assert row['night_leave_hours'] == pytest.approx(0.0)
        assert row['day_leave_hours']   == pytest.approx(4.0)

    def test_custom_leave_window_night_overlap(self):
        """Custom leave 21:00–23:00 on afternoon shift: 2h leave, 1h night leave."""
        assignment = _make_assignment(5, '2026-05-06', 'afternoon',
                                      '2026-05-06T15:00:00+04:00',
                                      '2026-05-07T00:00:00+04:00')
        leave = _make_leave(5, '2026-05-06', 'afternoon', 'other',
                            '2026-05-06T15:00:00+04:00',
                            '2026-05-07T00:00:00+04:00',
                            custom_start='21:00', custom_end='23:00')
        week_data = {'2026-05-04': {'assignments': [assignment], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '5', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-06')
        assert row['leave_hours']       == pytest.approx(2.0)   # 21:00–23:00
        assert row['night_leave_hours'] == pytest.approx(1.0)   # 22:00–23:00
        assert row['day_leave_hours']   == pytest.approx(1.0)   # 21:00–22:00

    def test_leave_on_rest_day_no_shift(self):
        """A leave record on a day with no shift still shows leave hours."""
        leave = _make_leave(6, '2026-05-20', 'day', 'all-day',
                            '2026-05-20T10:00:00+04:00',
                            '2026-05-20T19:00:00+04:00')
        week_data = {'2026-05-18': {'assignments': [], 'leaves': {'l1': leave}}}
        payload = {'employee_id': '6', 'year': 2026, 'month': 5}
        with _mock_db_for_weeks(week_data):
            resp = client.post(URL, json=payload, headers=VALID_HEADERS)
        row = next(d for d in resp.json()['days'] if d['date'] == '2026-05-20')
        assert row['is_rest_day'] is True
        assert row['leave_hours'] == pytest.approx(8.0)
        assert row['day_leave_hours'] == pytest.approx(8.0)
