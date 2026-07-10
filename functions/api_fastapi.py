#!/usr/bin/env python3
"""
FastAPI backend for CS Scheduler UI with Firebase Authentication
Provides REST API endpoints for the React frontend
"""

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import json
import base64
import csv
import io
import os
import logging
from datetime import datetime, timedelta, timezone
import firebase_admin
from firebase_admin import auth, credentials, db
import httpx

# Set logging level to WARNING to reduce console clutter (DEBUG logs for scheduler are verbose)
logging.basicConfig(level=logging.WARNING)
logging.getLogger("scheduler").setLevel(logging.WARNING)
logging.getLogger("firebase_admin").setLevel(logging.WARNING)

# Import scheduler from project root (scheduler.py)
from scheduler import build_model_and_solve

app = FastAPI(
    title="CS Scheduler API",
    description="REST API for 24/7 Customer Support Shift Scheduler with Firebase Auth",
    version="1.0.0"
)

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app",  # Cloud Run frontend
        "https://cs-scheduler-app.web.app",  # Firebase Hosting
        "https://cs-scheduler-app.firebaseapp.com",  # Alternative Firebase domain
        "http://localhost:3000",  # Local dev
        "http://localhost:5173",  # Vite dev server
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Initialize Firebase Admin SDK
# Use explicit service account credentials if provided (required for cross-project RTDB access)
if not firebase_admin._apps:
    _sa_b64 = os.getenv('FIREBASE_SERVICE_ACCOUNT_B64', '').strip()
    if _sa_b64:
        _sa_info = json.loads(base64.b64decode(_sa_b64).decode('utf-8'))
        _cred = credentials.Certificate(_sa_info)
        firebase_admin.initialize_app(_cred, {
            'databaseURL': 'https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app'
        })
    else:
        firebase_admin.initialize_app(options={
            'projectId': 'cs-scheduler-app',
            'databaseURL': 'https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app'
        })

# Cached Slack token (refreshed per-request to pick up RTDB updates)
_slack_token_cache: Dict[str, Optional[str]] = {'token': None}

def get_slack_token() -> Optional[str]:
    """Read Slack bot token — env var SLACK_BOT_TOKEN takes priority, then Firebase RTDB"""
    # 1. Check environment variable (set on Cloud Run)
    env_token = os.getenv('SLACK_BOT_TOKEN', '').strip()
    if env_token:
        return env_token
    # 2. Fall back to Firebase RTDB
    try:
        ref = db.reference('admin/slack_config/bot_token')
        raw = ref.get()  # type: ignore[assignment]
        token: Optional[str] = str(raw) if raw else None
        if token:
            _slack_token_cache['token'] = token
        return token
    except Exception as e:
        logging.warning(f'Could not read Slack token from RTDB: {e}')
        return None

async def lookup_slack_user(token: str, email: str) -> str:
    """Return Slack user_id for the given email"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            'https://slack.com/api/users.lookupByEmail',
            headers={'Authorization': f'Bearer {token}'},
            params={'email': email}
        )
        data = resp.json()
        if not data.get('ok'):
            raise ValueError(f"Slack user lookup failed for {email}: {data.get('error', 'unknown')}")
        return data['user']['id']

async def send_slack_dm(token: str, email: str, blocks: list, fallback_text: str) -> dict:
    """Look up Slack user by email and send them a Block Kit DM"""
    user_id = await lookup_slack_user(token, email)

    async with httpx.AsyncClient(timeout=10.0) as client:
        post_resp = await client.post(
            'https://slack.com/api/chat.postMessage',
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json; charset=utf-8'
            },
            json={'channel': user_id, 'text': fallback_text, 'blocks': blocks}
        )
        post_data = post_resp.json()
        if not post_data.get('ok'):
            raise ValueError(f"Slack DM failed: {post_data.get('error', 'unknown')}")

        return {'ok': True, 'user_id': user_id, 'ts': post_data.get('ts'), 'channel': post_data.get('channel')}

_SHIFT_EMOJIS = {'morning': '🌅 ', 'day': '☀️ ', 'afternoon': '🌇 ', 'night': '🌙 '}

def _shift_emoji(shift_type: str) -> str:
    return _SHIFT_EMOJIS.get(shift_type.lower(), '') if shift_type else ''

def build_swap_blocks(request_id: str, requester_name: str, original_shift: dict, target_shift: dict) -> list:
    """Build Slack Block Kit blocks for a swap request with Approve/Reject buttons"""
    return [
        {
            'type': 'section',
            'text': {
                'type': 'mrkdwn',
                'text': (
                    f"👋 *New shift swap request*\n\n"
                    f"*{requester_name}* wants to swap:\n"
                    f"• *Their shift:* {original_shift.get('date')} — {_shift_emoji(original_shift.get('type',''))}{original_shift.get('type')} ({original_shift.get('time')})\n"
                    f"• *Your shift:* {target_shift.get('date')} — {_shift_emoji(target_shift.get('type',''))}{target_shift.get('type')} ({target_shift.get('time')})"
                )
            }
        },
        {
            'type': 'actions',
            'elements': [
                {
                    'type': 'button',
                    'text': {'type': 'plain_text', 'text': '✅ Approve', 'emoji': True},
                    'style': 'primary',
                    'action_id': 'swap_approve',
                    'value': request_id
                },
                {
                    'type': 'button',
                    'text': {'type': 'plain_text', 'text': '❌ Reject', 'emoji': True},
                    'style': 'danger',
                    'action_id': 'swap_reject',
                    'value': request_id
                }
            ]
        }
    ]

def apply_shift_swap_rtdb(request_id: str, swap_request: dict) -> dict:
    """Apply the shift swap directly in Firebase RTDB (mirrors frontend applyShiftSwap logic)"""
    def get_week_start(date_str: str) -> str:
        from datetime import datetime, timedelta
        d = datetime.strptime(date_str, '%Y-%m-%d')
        diff = (d.weekday())  # Monday=0
        monday = d - timedelta(days=diff)
        return monday.strftime('%Y-%m-%d')

    original_shift = swap_request.get('originalShift', {})
    target_shift = swap_request.get('targetShift', {})

    original_week = get_week_start(original_shift['date'])
    target_week = get_week_start(target_shift['date'])

    original_ref = db.reference(f'schedules/{original_week}')
    original_data: dict = original_ref.get()  # type: ignore[assignment]
    if not original_data:
        return {'success': False, 'error': 'schedule-not-found'}

    if original_week == target_week:
        target_data = original_data
    else:
        target_ref = db.reference(f'schedules/{target_week}')
        target_data: dict = target_ref.get()  # type: ignore[assignment]
        if not target_data:
            return {'success': False, 'error': 'schedule-not-found'}

    original_assignments = list(original_data.get('assignments', []))
    target_assignments = original_assignments if original_week == target_week else list(target_data.get('assignments', []))

    orig_idx = next(
        (i for i, a in enumerate(original_assignments)
         if a.get('date') == original_shift['date']
         and a.get('shift_type') == original_shift.get('shift_type')
         and str(a.get('employee_id')) == str(original_shift.get('employee_id'))),
        -1
    )
    tgt_idx = next(
        (i for i, a in enumerate(target_assignments)
         if a.get('date') == target_shift['date']
         and a.get('shift_type') == target_shift.get('shift_type')
         and str(a.get('employee_id')) == str(target_shift.get('employee_id'))),
        -1
    )

    if orig_idx == -1 or tgt_idx == -1:
        return {'success': False, 'error': 'shift-not-found'}

    # Swap employee fields
    orig_emp_id = original_assignments[orig_idx]['employee_id']
    orig_emp_name = original_assignments[orig_idx]['employee_name']
    original_assignments[orig_idx] = {**original_assignments[orig_idx],
                                       'employee_id': target_assignments[tgt_idx]['employee_id'],
                                       'employee_name': target_assignments[tgt_idx]['employee_name']}
    target_assignments[tgt_idx] = {**target_assignments[tgt_idx],
                                    'employee_id': orig_emp_id,
                                    'employee_name': orig_emp_name}

    now = datetime.utcnow().isoformat()
    meta = {'requestId': request_id, 'appliedAt': now, 'appliedBy': 'slack-bot'}

    original_ref.set({**original_data, 'assignments': original_assignments, 'lastSwapApplied': meta})

    if original_week != target_week:
        db.reference(f'schedules/{target_week}').set(
            {**target_data, 'assignments': target_assignments, 'lastSwapApplied': meta}
        )

    return {'success': True}

# Admin users who can perform administrative actions
# Load from environment variable if available, otherwise use hardcoded fallback
import os
ADMIN_USERS_ENV = os.getenv('ADMIN_EMAILS', '')
if ADMIN_USERS_ENV:
    ADMIN_USERS = {email.strip() for email in ADMIN_USERS_ENV.split(',') if email.strip()}
else:
    # Fallback to hardcoded list for backward compatibility
    ADMIN_USERS = {
        'kordzadze2002@gmail.com',
        'nino.gogoladze@example.com',
        'giga.melikidze@example.com'
    }

# Lowercase version for case-insensitive comparison
ADMIN_USERS_LOWER = {email.lower() for email in ADMIN_USERS}

# Pydantic models
class Employee(BaseModel):
    id: int
    name: str
    manually_assigned_morning: Optional[bool] = False
    had_morning_last_week: Optional[bool] = False
    had_sunday_night: Optional[bool] = False
    had_sunday_day: Optional[bool] = False
    had_sunday_afternoon: Optional[bool] = False
    past_week_counts: Optional[Dict[str, int]] = {'night': 1, 'day': 1, 'afternoon': 2}

class ScheduleOptions(BaseModel):
    allow_exception: Optional[bool] = False
    solver_time_limit: Optional[int] = 60
    use_greedy_fallback: Optional[bool] = True

class ScheduleRequest(BaseModel):
    week_start: str  # YYYY-MM-DD format
    employees: List[Employee]
    options: Optional[ScheduleOptions] = ScheduleOptions()

class ScheduleResponse(BaseModel):
    success: bool
    assignments: Optional[List[Dict[str, Any]]] = []
    summary: Optional[Dict[str, Any]] = {}
    status: Optional[str] = None
    solver_time: Optional[float] = 0
    error: Optional[str] = None
    details: Optional[str] = None

# Authentication helper functions
def verify_token_and_domain(request: Request):
    """Verify Firebase ID token and check if user is from @example.com domain"""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=403, detail="Missing or invalid Authorization header")
    
    token = auth_header.split('Bearer ')[1]
    
    try:
        # Verify the ID token
        decoded_token = auth.verify_id_token(token)
        email = decoded_token.get('email')
        
        if not email:
            raise HTTPException(status_code=403, detail="No email found in token")
        
        # Check if email is from @example.com domain
        if not email.endswith('@example.com'):
            raise HTTPException(
                status_code=403, 
                detail=f"Access denied. Only @example.com emails are allowed. Your email: {email}"
            )
        
        return decoded_token
        
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Invalid token: {str(e)}")

def verify_admin_access(request: Request):
    """Verify Firebase ID token and check if user is an admin"""
    decoded_token = verify_token_and_domain(request)
    
    email = decoded_token.get('email')
    email_lower = email.lower() if email else ''
    
    print(f"🔍 Checking admin access for: {email}")
    print(f"🔍 Email (lowercase): {email_lower}")
    print(f"🔍 ADMIN_USERS set: {ADMIN_USERS}")
    print(f"🔍 ADMIN_USERS_LOWER set: {ADMIN_USERS_LOWER}")
    print(f"🔍 Is in ADMIN_USERS (exact): {email in ADMIN_USERS}")
    print(f"🔍 Is in ADMIN_USERS_LOWER: {email_lower in ADMIN_USERS_LOWER}")
    
    if email_lower not in ADMIN_USERS_LOWER:
        print(f"❌ Access denied for: {email}")
        raise HTTPException(
            status_code=403, 
            detail=f"Access denied. Admin privileges required. Your email: {email}"
        )
    
    print(f"✅ Admin access granted for: {email}")
    return decoded_token

def verify_token_or_scheduler(request: Request):
    """
    Verify either:
    1. Firebase ID token from admin user, OR
    2. OIDC token from Cloud Scheduler service account
    
    This allows both manual calls (from UI) and automated calls (from Cloud Scheduler).
    """
    auth_header = request.headers.get('Authorization')
    
    # Check if request comes from Cloud Scheduler (has specific User-Agent)
    user_agent = request.headers.get('User-Agent', '')
    if 'Google-Cloud-Scheduler' in user_agent:
        # This is from Cloud Scheduler, allow it
        return {'type': 'scheduler', 'email': 'cloud-scheduler'}
    
    # Otherwise, require Firebase admin authentication
    if not auth_header or not auth_header.startswith('Bearer '):
        raise HTTPException(status_code=403, detail="Missing or invalid Authorization header")
    
    token = auth_header.split('Bearer ')[1]
    
    try:
        decoded_token = auth.verify_id_token(token)
        email = decoded_token.get('email')
        email_lower = email.lower() if email else ''
        
        if not email or email_lower not in ADMIN_USERS_LOWER:
            raise HTTPException(status_code=403, detail="Admin access required")
        
        return {'type': 'firebase', 'email': email, 'token': decoded_token}
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Invalid authentication: {str(e)}")

# API Endpoints
@app.get("/", tags=["Health"])
@app.get("/api/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "message": "CS Scheduler API",
        "version": "1.0.0",
        "cors": "enabled"
    }

@app.options("/api/generate-schedule", tags=["CORS"])
async def options_generate_schedule():
    """Handle preflight CORS requests for generate-schedule"""
    return {"status": "ok"}

@app.post("/api/generate-schedule", tags=["Schedule"])
async def generate_schedule(
    request: Request,
    user: dict = Depends(verify_admin_access)
):
    """Generate schedule endpoint - admin only"""
    
    try:
        # Get raw JSON data to avoid Pydantic parsing issues
        request_data = await request.json()
        
        print(f"DEBUG: Raw request data keys: {request_data.keys()}")
        
        # Extract data with defaults
        week_start = request_data.get('week_start')
        employees_data = request_data.get('employees', [])
        options = request_data.get('options', {})
        
        # Validate required fields
        if not week_start or not employees_data:
            raise HTTPException(
                status_code=400,
                detail="Missing required fields: week_start and employees"
            )
        
        # Validate date format
        try:
            datetime.strptime(week_start, '%Y-%m-%d')
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid week_start format. Expected YYYY-MM-DD"
            )
        
        # Validate employees array
        if not isinstance(employees_data, list) or len(employees_data) == 0:
            raise HTTPException(
                status_code=400,
                detail="employees must be a non-empty array"
            )
        
        # Validate each employee has required fields
        for i, emp in enumerate(employees_data):
            if not isinstance(emp, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"Employee at index {i} must be an object"
                )
            if 'id' not in emp or 'name' not in emp:
                raise HTTPException(
                    status_code=400,
                    detail=f"Employee at index {i} missing required fields 'id' or 'name'"
                )
        
        # Build employee list
        employees = []
        for emp_data in employees_data:
            employee = {
                'id': emp_data.get('id'),
                'name': emp_data.get('name'),
                'manually_assigned_morning': emp_data.get('manually_assigned_morning', False),
                'had_morning_last_week': emp_data.get('had_morning_last_week', False),
                'past_week_counts': emp_data.get('past_week_counts') or {},
                # Cross-week Sunday constraints
                'had_sunday_night': emp_data.get('had_sunday_night', False),
                'had_sunday_day': emp_data.get('had_sunday_day', False),
                'had_sunday_afternoon': emp_data.get('had_sunday_afternoon', False),
                # Trailing consecutive patterns
                'trailing_consecutive_work_days': emp_data.get('trailing_consecutive_work_days', 0),
                'trailing_consecutive_nights': emp_data.get('trailing_consecutive_nights', 0),
                # Day-off dates (list of YYYY-MM-DD strings)
                'day_offs': emp_data.get('day_offs', []),
                # Number of all-day leaves this week (reduces required shifts)
                'leave_count': int(emp_data.get('leave_count') or 0),
            }
            employees.append(employee)
        
        # Log day_offs for debugging
        emps_with_dayoffs = [e for e in employees if e.get('day_offs')]
        if emps_with_dayoffs:
            print(f"DEBUG: Employees with day_offs: {[(e['name'], e['day_offs']) for e in emps_with_dayoffs]}")
        else:
            print("DEBUG: No employees have day_offs set")
        
        # Build specification for the scheduler
        spec = {
            'week_start': week_start,
            'employees': employees,
            'allow_same_day_morning_night_exception': options.get('allow_same_day_morning_night_exception', False),
            'max_solve_time': options.get('max_solve_time', 30),
            'timezone': options.get('timezone', 'UTC')
        }
        
        # Include shift_definitions if provided (pattern-free scheduling)
        if 'shift_definitions' in request_data:
            spec['shift_definitions'] = request_data['shift_definitions']
            print(f"DEBUG: Using shift_definitions from request: {list(spec['shift_definitions'].keys())}")
        
        # Include shift_combinations if provided (legacy support - not used in pattern-free mode)
        if 'shift_combinations' in request_data:
            spec['shift_combinations'] = request_data['shift_combinations']
        
        # Include pre_assigned_shifts if provided (locked shifts that must be in the schedule)
        if 'pre_assigned_shifts' in request_data:
            spec['pre_assigned_shifts'] = request_data['pre_assigned_shifts']
            print(f"DEBUG: Pre-assigned shifts count: {len(spec['pre_assigned_shifts'])}")
        
        # Include high_traffic_days if provided (admin-selected priority days for staffing)
        if 'high_traffic_days' in request_data:
            spec['high_traffic_days'] = request_data['high_traffic_days']
            print(f"DEBUG: High-traffic days: {spec['high_traffic_days']}")
        
        # Call the scheduler
        result = build_model_and_solve(spec)
        
        print(f"DEBUG: Scheduler result keys: {result.keys()}")
        print(f"DEBUG: Status: {result.get('status')}")
        print(f"DEBUG: Assignments length: {len(result.get('assignments', []))}")
        
        if result['status'] in ['optimal', 'feasible']:
            # Ensure all data is JSON serializable
            assignments = result.get('assignments', [])
            summary = result.get('summary', {})
            
            # Convert any problematic objects to basic types
            import json
            try:
                # Test if the data can be JSON serialized
                json.dumps(assignments)
                json.dumps(summary)
            except Exception as e:
                print(f"DEBUG: JSON serialization error: {e}")
                # Fallback to basic response
                return {
                    "success": True,
                    "assignments": [],
                    "summary": {},
                    "status": result['status'],
                    "solver_time": result.get('solver_time', 0),
                    "error": f"Serialization error: {str(e)}"
                }
            
            return {
                "success": True,
                "assignments": assignments,
                "summary": summary,
                "status": result['status'],
                "solver_time": result.get('solver_time', 0)
            }
        else:
            # Infeasible case - pass through all diagnostic information
            # Build error_detail from whichever fields the scheduler provided
            # (early feasibility check uses 'reason'/'reasons'/'details'; solver uses 'error_detail')
            raw_error_detail = result.get('error_detail')
            if not raw_error_detail:
                reasons_list = result.get('reasons', [])
                reason_str = result.get('reason', '')
                details_str = result.get('details', '')
                if reasons_list:
                    raw_error_detail = "\n".join(f"• {r}" for r in reasons_list)
                elif reason_str:
                    raw_error_detail = reason_str
                elif details_str:
                    # 'details' is a long formatted string; extract just the relevant part
                    for line in details_str.splitlines():
                        if 'Reason' in line or 'INFEASIBLE' in line or '•' in line:
                            raw_error_detail = (raw_error_detail or '') + line.strip() + '\n'
                    raw_error_detail = (raw_error_detail or '').strip() or details_str
                else:
                    raw_error_detail = 'No detailed message available'

            return {
                "success": False,
                "status": result['status'],
                "error": result.get('error', f"Solver status: {result['status']}"),
                "error_detail": raw_error_detail,
                "details": raw_error_detail,  # Legacy field
                "diagnostic": result.get('diagnostic', {}),
                "assignments": result.get('assignments', []),
                "solve_time": result.get('solve_time', 0)
            }
            
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"ERROR: Exception in generate_schedule: {str(e)}")
        print(f"TRACEBACK: {error_trace}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )

@app.post("/api/export-csv", tags=["Export"])
async def export_csv(
    request: Request,
    schedule_data: Dict[str, Any],
    user: dict = Depends(verify_admin_access)
):
    """Export schedule as CSV - admin only"""
    
    try:
        # Create CSV from schedule data
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow(['Employee ID', 'Employee Name', 'Date', 'Shift Type', 'Start Time', 'End Time'])
        
        # Write assignments
        assignments = schedule_data.get('assignments', [])
        for assignment in assignments:
            writer.writerow([
                assignment.get('employee_id', ''),
                assignment.get('employee_name', ''),
                assignment.get('date', ''),
                assignment.get('shift_type', ''),
                assignment.get('start_datetime', ''),
                assignment.get('end_datetime', '')
            ])
        
        output.seek(0)
        
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode('utf-8')),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=schedule.csv"}
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"CSV export failed: {str(e)}"
        )

@app.post("/api/export-json", tags=["Export"])
async def export_json(
    request: Request,
    schedule_data: Dict[str, Any],
    user: dict = Depends(verify_admin_access)
):
    """Export schedule as JSON - admin only"""
    
    return schedule_data

@app.post("/api/test-schedule", tags=["Test"])
async def test_schedule(
    schedule_request: ScheduleRequest,
    request: Request,
    user: dict = Depends(verify_admin_access)
):
    """Test endpoint to debug the schedule request"""
    
    try:
        print(f"DEBUG: Received request with {len(schedule_request.employees)} employees")
        print(f"DEBUG: Week start: {schedule_request.week_start}")
        print(f"DEBUG: Options: {schedule_request.options}")
        
        return {
            "success": True,
            "message": "Request received successfully",
            "employees_count": len(schedule_request.employees),
            "week_start": schedule_request.week_start
        }
    except Exception as e:
        print(f"DEBUG: Error in test endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/employees", tags=["Employees"])
async def get_default_employees(
    request: Request,
    user: dict = Depends(verify_token_and_domain)
):
    """Get default employee list - authenticated users only"""
    
    default_employees = [
        {"id": i, "name": f"Employee_{i}"} for i in range(1, 15)
    ]
    return {"employees": default_employees}

class SlackNotifyRequest(BaseModel):
    request_id: str
    target_email: str
    requester_name: str
    original_shift: Dict[str, str]   # {date, type, time}
    target_shift: Dict[str, str]     # {date, type, time}

class ScheduleReadyRequest(BaseModel):
    week_label: str   # e.g. "April 21 – April 27"

@app.post("/api/notify-schedule-ready", tags=["Notifications"])
async def notify_schedule_ready(
    request: Request,
    body: ScheduleReadyRequest,
    user: dict = Depends(verify_admin_access)
):
    """Send a Slack DM to all employees notifying them the schedule is ready"""
    token = get_slack_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Slack token not configured."
        )

    # Load all team members
    try:
        members_data: dict = db.reference('teamMembers').get()  # type: ignore[assignment]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load team members: {e}")

    if not members_data:
        return {"success": True, "sent": 0, "message": "No team members found"}

    members: list = list(members_data.values()) if isinstance(members_data, dict) else members_data
    emails = [m['email'] for m in members if isinstance(m, dict) and m.get('email')]

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"📅 *Week of {body.week_label} Schedule is Ready!*\n\n"
                    f"Please visit <https://cs-scheduler-app.web.app|cs-scheduler-app.web.app> to see your schedule."
                )
            }
        }
    ]
    fallback = f"Week of {body.week_label} Schedule is Ready! Visit cs-scheduler-app.web.app to see your schedule."

    sent = 0
    errors = []
    for email in emails:
        try:
            await send_slack_dm(token, email, blocks, fallback)
            sent += 1
        except Exception as e:
            logging.warning(f"Could not DM {email}: {e}")
            errors.append(f"{email}: {e}")

    return {"success": True, "sent": sent, "total": len(emails), "errors": errors}


@app.post("/api/notify-slack", tags=["Notifications"])
async def notify_slack(
    request: Request,
    body: SlackNotifyRequest,
    user: dict = Depends(verify_token_and_domain)
):
    """Send a Slack DM with Approve/Reject buttons to notify an employee of a swap request"""
    token = get_slack_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Slack token not configured. Add it to admin/slack_config/bot_token in Firebase RTDB."
        )

    blocks = build_swap_blocks(body.request_id, body.requester_name, body.original_shift, body.target_shift)
    fallback = f"{body.requester_name} wants to swap shifts with you. Open the CS Scheduler app to respond."

    try:
        result = await send_slack_dm(token, body.target_email, blocks, fallback)
        return {"success": True, "user_id": result.get('user_id')}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logging.error(f"Slack notification error: {e}")
        raise HTTPException(status_code=500, detail=f"Slack error: {str(e)}")


@app.post("/api/slack-action", tags=["Notifications"])
async def slack_action(request: Request):
    """Handle Slack interactive button actions (Approve / Reject swap)"""
    import urllib.parse

    body_bytes = await request.body()
    body_str = body_bytes.decode('utf-8')

    # Slack sends payload as application/x-www-form-urlencoded
    parsed = urllib.parse.parse_qs(body_str)
    payload_json = parsed.get('payload', [None])[0]
    if not payload_json:
        raise HTTPException(status_code=400, detail='Missing payload')

    payload = json.loads(payload_json)
    actions = payload.get('actions', [])
    if not actions:
        return {'ok': True}

    action = actions[0]
    action_id = action.get('action_id')   # 'swap_approve' or 'swap_reject'
    request_id = action.get('value')       # Firebase swap request ID
    response_url = payload.get('response_url')
    actor_id = payload.get('user', {}).get('id', 'unknown')

    token = get_slack_token()

    async def update_message(text: str):
        """Replace the original message with a plain confirmation"""
        if response_url and token:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(response_url, json={
                    'replace_original': True,
                    'text': text,
                    'blocks': []
                })

    if action_id not in ('swap_approve', 'swap_reject'):
        return {'ok': True}

    # Load the swap request from RTDB
    try:
        swap_ref = db.reference(f'shiftSwapRequests/{request_id}')
        swap_data: dict = swap_ref.get()  # type: ignore[assignment]
    except Exception as e:
        await update_message(f'⚠️ Could not load swap request: {e}')
        return {'ok': True}

    if not swap_data:
        await update_message('⚠️ Swap request not found (may have already been processed).')
        return {'ok': True}

    if swap_data.get('status') in ('approved', 'rejected'):
        await update_message(f'ℹ️ This request was already *{swap_data.get("status")}*.')
        return {'ok': True}

    now = datetime.utcnow().isoformat()

    requester_email = swap_data.get('requesterEmail') or swap_data.get('requester_email', '')
    original_shift = swap_data.get('originalShift') or swap_data.get('original_shift', {})
    target_shift = swap_data.get('targetShift') or swap_data.get('target_shift', {})

    if action_id == 'swap_approve':
        # Apply the actual shift swap in Firebase schedules
        result = apply_shift_swap_rtdb(request_id, swap_data)
        if not result['success']:
            await update_message(f'❌ Failed to apply swap: {result["error"]}')
            return {'ok': True}

        # Update request status
        swap_ref.set({**swap_data,
                      'status': 'approved',
                      'updatedAt': now,
                      'updatedBy': f'slack:{actor_id}',
                      'adminApprovedBy': f'slack:{actor_id}',
                      'adminApprovedAt': now})
        await update_message('✅ Shift swap *approved* and applied to the schedule!')

        # Notify the requester
        if requester_email and token:
            orig_label = f"{original_shift.get('date', '')} {original_shift.get('shift_type', '')}".strip()
            tgt_label = f"{target_shift.get('date', '')} {target_shift.get('shift_type', '')}".strip()
            requester_blocks = [
                {"type": "section", "text": {"type": "mrkdwn",
                    "text": f"✅ *Your shift swap request was approved!*\n*From:* {orig_label}\n*To:* {tgt_label}\n\nThe schedule has been updated."}}
            ]
            try:
                await send_slack_dm(token, requester_email, requester_blocks, f"Your shift swap was approved: {orig_label} ↔ {tgt_label}")
            except Exception as e:
                logging.warning(f"Could not DM requester {requester_email}: {e}")

    elif action_id == 'swap_reject':
        swap_ref.set({**swap_data,
                      'status': 'rejected',
                      'updatedAt': now,
                      'updatedBy': f'slack:{actor_id}',
                      'adminApprovedBy': f'slack:{actor_id}',
                      'adminApprovedAt': now})
        await update_message('❌ Shift swap *rejected*.')

        # Notify the requester
        if requester_email and token:
            orig_label = f"{original_shift.get('date', '')} {original_shift.get('shift_type', '')}".strip()
            tgt_label = f"{target_shift.get('date', '')} {target_shift.get('shift_type', '')}".strip()
            requester_blocks = [
                {"type": "section", "text": {"type": "mrkdwn",
                    "text": f"❌ *Your shift swap request was rejected.*\n*From:* {orig_label}\n*To:* {tgt_label}\n\nPlease contact your manager for more details."}}
            ]
            try:
                await send_slack_dm(token, requester_email, requester_blocks, f"Your shift swap was rejected: {orig_label} ↔ {tgt_label}")
            except Exception as e:
                logging.warning(f"Could not DM requester {requester_email}: {e}")

    return {'ok': True}


# Shift start times in local time (Tbilisi, UTC+4) — used for reminders
SHIFT_START_TIMES = {
    'morning':   '04:00',
    'day':       '10:00',
    'afternoon': '15:00',
    'night':     '19:00',
}
TBILISI_OFFSET = timedelta(hours=4)

@app.post("/api/send-shift-reminders", tags=["Notifications"])
async def send_shift_reminders(request: Request):
    """
    Send Slack DM reminders to employees whose shift starts in ~10 minutes.
    Call this via Cloud Scheduler at 03:50, 09:50, 14:50, 18:50 Tbilisi time.
    Allows an X-Cron-Secret header for light verification.
    """
    # Optional secret check to prevent arbitrary public calls
    cron_secret = os.getenv('CRON_SECRET', '')
    if cron_secret:
        incoming = request.headers.get('X-Cron-Secret', '')
        if incoming != cron_secret:
            raise HTTPException(status_code=401, detail='Unauthorized')

    token = get_slack_token()
    if not token:
        return {'ok': False, 'error': 'Slack token not configured'}

    # Determine current Tbilisi time
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc + TBILISI_OFFSET
    today_str = now_local.strftime('%Y-%m-%d')

    # Which shift(s) start in 5–15 minutes from now?
    target_types = []
    for shift_type, start_str in SHIFT_START_TIMES.items():
        h, m = map(int, start_str.split(':'))
        shift_start = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
        minutes_until = (shift_start - now_local).total_seconds() / 60
        if 5 <= minutes_until <= 15:
            target_types.append(shift_type)

    if not target_types:
        return {'ok': True, 'sent': 0, 'message': 'No shifts starting soon'}

    # Find Monday of current week
    days_since_monday = now_local.weekday()
    week_start = (now_local - timedelta(days=days_since_monday)).strftime('%Y-%m-%d')

    # Load schedule for this week
    try:
        sched_data: dict = db.reference(f'schedules/{week_start}').get()  # type: ignore[assignment]
    except Exception as e:
        logging.error(f'Reminder: failed to load schedule: {e}')
        return {'ok': False, 'error': str(e)}

    if not sched_data:
        return {'ok': True, 'sent': 0, 'message': 'No schedule found for this week'}

    assignments = sched_data.get('assignments', [])
    if isinstance(assignments, dict):
        assignments = list(assignments.values())

    # Load team members to get emails
    try:
        members_data = db.reference('teamMembers').get() or {}
    except Exception as e:
        logging.error(f'Reminder: failed to load team members: {e}')
        members_data = {}

    # Build id→email map
    id_to_email: dict = {}
    if isinstance(members_data, dict):
        for v in members_data.values():
            if isinstance(v, dict) and v.get('email'):
                id_to_email[str(v.get('id', ''))] = v['email']
                id_to_email[str(v.get('name', ''))] = v['email']  # fallback by name
    elif isinstance(members_data, list):
        for v in members_data:
            if isinstance(v, dict) and v.get('email'):
                id_to_email[str(v.get('id', ''))] = v['email']
                id_to_email[str(v.get('name', ''))] = v['email']

    SHIFT_LABELS = {
        'morning':   '🌅 Morning shift  04:00 – 13:00',
        'day':       '☀️ Day shift  10:00 – 19:00',
        'afternoon': '🌇 Afternoon shift  15:00 – 00:00',
        'night':     '🌙 Night shift  19:00 – 04:00',
    }

    sent = 0
    errors = []
    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        if assignment.get('date') != today_str:
            continue
        if assignment.get('shift_type') not in target_types:
            continue

        emp_id = str(assignment.get('employee_id', ''))
        emp_name = assignment.get('employee_name', '')
        email = id_to_email.get(emp_id) or id_to_email.get(emp_name)
        if not email:
            continue

        shift_type = assignment.get('shift_type')
        label = SHIFT_LABELS.get(shift_type or '', shift_type or '')
        blocks = [
            {
                'type': 'section',
                'text': {
                    'type': 'mrkdwn',
                    'text': f'⏰ *Shift reminder, {emp_name}!*\nYour *{label}* starts in 10 minutes.\nPlease be ready! 💪'
                }
            }
        ]
        try:
            await send_slack_dm(token, email, blocks, f"Reminder: your {shift_type} shift starts in 10 minutes!")
            sent += 1
        except Exception as e:
            logging.warning(f'Reminder: could not DM {email}: {e}')
            errors.append(str(e))

    return {'ok': True, 'sent': sent, 'errors': errors}


@app.post("/api/send-daily-shifts", tags=["Notifications"])
async def send_daily_shifts(
    request: Request,
    user: dict = Depends(verify_token_or_scheduler)
):
    """
    Send daily shift schedule to admins via Slack DM.
    Shows all shifts and leaves for today with proper timeframe labels.
    Can be called manually (test_mode) or automatically via Cloud Scheduler.
    """
    body = await request.json()
    test_mode = body.get('test_mode', False)
    target_date = body.get('date')  # YYYY-MM-DD format, optional
    
    # Load Slack notification settings from Firebase
    try:
        settings_ref = db.reference('admin/slack_notification_settings')
        settings: dict = settings_ref.get() or {}  # type: ignore[assignment]
    except Exception as e:
        logging.error(f'Failed to load Slack notification settings: {e}')
        settings = {}
    
    if not test_mode and not settings.get('enabled', False):
        return {'ok': True, 'message': 'Daily notifications are disabled'}
    
    # Check if we should notify on weekends
    notify_on_weekends = settings.get('notifyOnWeekends', True)
    
    # Determine target date (today in Tbilisi timezone if not provided)
    if not target_date:
        now_utc = datetime.now(timezone.utc)
        now_local = now_utc + TBILISI_OFFSET
        target_date = now_local.strftime('%Y-%m-%d')
        
        # Check if today is weekend
        if not notify_on_weekends:
            weekday = now_local.weekday()
            if weekday >= 5:  # Saturday=5, Sunday=6
                return {'ok': True, 'message': 'Skipping weekend notification'}
    
    # Get Slack token
    token = get_slack_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Slack token not configured. Add it to admin/slack_config/bot_token in Firebase RTDB."
        )
    
    # Find Monday of the week containing target_date
    target_dt = datetime.strptime(target_date, '%Y-%m-%d')
    days_since_monday = target_dt.weekday()
    week_start = (target_dt - timedelta(days=days_since_monday)).strftime('%Y-%m-%d')
    
    # Load schedule for this week
    try:
        sched_data: dict = db.reference(f'schedules/{week_start}').get()  # type: ignore[assignment]
    except Exception as e:
        logging.error(f'Failed to load schedule for week {week_start}: {e}')
        raise HTTPException(status_code=500, detail=f'Failed to load schedule: {str(e)}')
    
    if not sched_data:
        raise HTTPException(status_code=404, detail=f'No schedule found for week starting {week_start}')
    
    # Extract assignments and leaves
    assignments = sched_data.get('assignments', [])
    if isinstance(assignments, dict):
        assignments = list(assignments.values())
    
    leaves_data = sched_data.get('leaves', {})
    if isinstance(leaves_data, dict):
        leaves = list(leaves_data.values())
    else:
        leaves = leaves_data if isinstance(leaves_data, list) else []
    
    # Filter assignments for target date
    today_assignments = [a for a in assignments if isinstance(a, dict) and a.get('date') == target_date]
    today_leaves = [l for l in leaves if isinstance(l, dict) and l.get('date') == target_date]
    
    # Load team members to get employee names
    try:
        members_data = db.reference('teamMembers').get() or {}
    except Exception as e:
        logging.error(f'Failed to load team members: {e}')
        members_data = {}
    
    # Build id→name map
    id_to_name: dict = {}
    if isinstance(members_data, dict):
        for v in members_data.values():
            if isinstance(v, dict):
                emp_id = str(v.get('id', ''))
                emp_name = v.get('name', '')
                if emp_id and emp_name:
                    id_to_name[emp_id] = emp_name
    elif isinstance(members_data, list):
        for v in members_data:
            if isinstance(v, dict):
                emp_id = str(v.get('id', ''))
                emp_name = v.get('name', '')
                if emp_id and emp_name:
                    id_to_name[emp_id] = emp_name
    
    # Organize leaves with timeframe
    leaves_list = []
    full_day_leave_emp_ids = set()  # Track employees with full day leaves
    
    for leave in today_leaves:
        emp_id = str(leave.get('employee_id', ''))
        emp_name = id_to_name.get(emp_id, f'Employee {emp_id}')
        timeframe = leave.get('timeframe', 'Full Day')
        leave_type = leave.get('leave_type', '')
        
        # Format timeframe label
        if timeframe.lower() in ['first_half', 'first half', 'morning']:
            timeframe_label = 'First Half - Morning'
        elif timeframe.lower() in ['second_half', 'second half', 'afternoon', 'evening']:
            timeframe_label = 'Second Half - Afternoon/Night'
        elif timeframe.lower() in ['full_day', 'full day', 'all_day', 'all day']:
            timeframe_label = 'Full Day'
            full_day_leave_emp_ids.add(emp_id)  # Track full day leave employees
        else:
            timeframe_label = timeframe
        
        leave_label = f"{emp_name} ({timeframe_label})"
        if leave_type:
            leave_label += f" - {leave_type}"
        
        leaves_list.append(leave_label)
    
    # Organize shifts by type (excluding employees with full day leaves)
    shifts_by_type = {
        'morning': [],
        'day': [],
        'afternoon': [],
        'night': []
    }
    
    for assignment in today_assignments:
        shift_type = assignment.get('shift_type', '').lower()
        emp_id = str(assignment.get('employee_id', ''))
        
        # Skip employees with full day leaves
        if emp_id in full_day_leave_emp_ids:
            continue
        
        emp_name = assignment.get('employee_name') or id_to_name.get(emp_id, f'Employee {emp_id}')
        
        if shift_type in shifts_by_type:
            shifts_by_type[shift_type].append(emp_name)
    
    # Format date nicely
    date_obj = datetime.strptime(target_date, '%Y-%m-%d')
    day_name = date_obj.strftime('%A')
    formatted_date = date_obj.strftime('%B %d, %Y')
    
    # Build message text
    message_lines = [f"📅 *Shift Schedule for {day_name}, {formatted_date}*\n"]
    
    shift_emojis = {
        'morning': '🌅',
        'day': '☀️',
        'afternoon': '🌆',
        'night': '🌙'
    }
    
    shift_labels = {
        'morning': 'Morning (04:00–13:00)',
        'day': 'Day (10:00–19:00)',
        'afternoon': 'Afternoon (15:00–00:00)',
        'night': 'Night (19:00–04:00)'
    }
    
    for shift_type in ['morning', 'day', 'afternoon', 'night']:
        employees_list = shifts_by_type.get(shift_type, [])
        emoji = shift_emojis.get(shift_type, '⏰')
        label = shift_labels.get(shift_type, shift_type.title())
        
        message_lines.append(f"\n{emoji} *{label}*")
        if employees_list:
            for emp_name in sorted(employees_list):
                message_lines.append(f"• {emp_name}")
        else:
            message_lines.append("• (No one scheduled)")
    
    # Add leaves section if any
    if leaves_list:
        message_lines.append("\n🏖️ *On Leave*")
        for leave_label in sorted(leaves_list):
            message_lines.append(f"• {leave_label}")
    
    message_text = '\n'.join(message_lines)
    
    # Load admin assignments for 1:1 catchup suggestions
    admin_assignments = []
    try:
        assignments_data = settings.get('adminAssignments', [])
        if isinstance(assignments_data, list):
            admin_assignments = assignments_data
    except Exception as e:
        logging.warning(f'Failed to load admin assignments: {e}')
    
    # Helper function to build 1:1 catchup suggestions for an admin
    def build_catchup_suggestions(admin_email: str) -> str:
        """Build personalized 1:1 catchup suggestions based on admin's assigned employees"""
        # Find admin's assignment
        admin_assignment = None
        for assignment in admin_assignments:
            if assignment.get('email') == admin_email:
                admin_assignment = assignment
                break
        
        if not admin_assignment or not admin_assignment.get('employees'):
            return ""  # No assigned employees
        
        assigned_emp_ids = [str(emp_id) for emp_id in admin_assignment.get('employees', [])]
        
        # Get employees on leave today (to exclude them)
        leave_emp_ids = set(str(leave.get('employee_id', '')) for leave in today_leaves)
        
        # Group employees by shift type (only those assigned to this admin and not on leave)
        morning_window = []
        full_day_window = []
        afternoon_window = []
        
        for shift_type, employees_list in shifts_by_type.items():
            if shift_type == 'night':
                continue  # Skip night shift (no overlap with manager hours)
            
            for emp_name in employees_list:
                # Find employee ID by name
                emp_id = None
                for eid, ename in id_to_name.items():
                    if ename == emp_name:
                        emp_id = eid
                        break
                
                # Check if employee is assigned to this admin and not on leave
                if emp_id and emp_id in assigned_emp_ids and emp_id not in leave_emp_ids:
                    if shift_type == 'morning':
                        morning_window.append(emp_name)
                    elif shift_type == 'day':
                        full_day_window.append(emp_name)
                    elif shift_type == 'afternoon':
                        afternoon_window.append(emp_name)
        
        # Build the catchup section
        if not (morning_window or full_day_window or afternoon_window):
            return ""  # No available employees for catchup today
        
        catchup_lines = [
            "\n---\n"
        ]
        
        if morning_window:
            catchup_lines.append("🕙 *Morning Window (10:00 AM - 1:00 PM)*")
            for emp_name in sorted(morning_window):
                catchup_lines.append(f"• {emp_name}")
            catchup_lines.append("")
        
        if full_day_window:
            catchup_lines.append("🕐 *Full Day Window (10:00 AM - 7:00 PM)*")
            for emp_name in sorted(full_day_window):
                catchup_lines.append(f"• {emp_name}")
            catchup_lines.append("")
        
        if afternoon_window:
            catchup_lines.append("🕒 *Afternoon Window (3:00 PM - 7:00 PM)*")
            for emp_name in sorted(afternoon_window):
                catchup_lines.append(f"• {emp_name}")
        
        return '\n'.join(catchup_lines)
    
    # Load admin emails
    try:
        admin_ref = db.reference('admin/admin-emails')
        admin_emails_data = admin_ref.get()
        if isinstance(admin_emails_data, list):
            admin_emails = admin_emails_data
        else:
            # Fallback to hardcoded admins
            admin_emails = [
                'kordzadze2002@gmail.com',
                'nino.gogoladze@example.com',
                'giga.melikidze@example.com'
            ]
    except Exception as e:
        logging.warning(f'Failed to load admin emails: {e}')
        admin_emails = [
            'kordzadze2002@gmail.com',
            'nino.gogoladze@example.com',
            'giga.melikidze@example.com'
        ]
    
    # In test mode, only send to kordzadze2002@gmail.com
    if test_mode:
        admin_emails = ['kordzadze2002@gmail.com']
    
    # Helper function to extract first name from email
    def get_admin_first_name(email: str) -> str:
        """Extract first name from email like 'kordzadze2002@gmail.com' -> 'Ioane'"""
        try:
            username = email.split('@')[0]
            first_name = username.split('.')[0]
            return first_name.capitalize()
        except:
            return 'Admin'
    
    # Send message to each admin
    sent_to = []
    errors = []
    
    for admin_email in admin_emails:
        try:
            # Personalize message with admin's name
            admin_name = get_admin_first_name(admin_email)
            personalized_message = f"Good Morning *{admin_name}*! 👋\n📅 *Today's Shift Schedule for {day_name}, {formatted_date}*\n" + '\n'.join(message_lines[1:])
            
            # Add 1:1 catchup suggestions for this admin
            catchup_section = build_catchup_suggestions(admin_email)
            if catchup_section:
                personalized_message += catchup_section
            
            blocks = [
                {
                    'type': 'section',
                    'text': {
                        'type': 'mrkdwn',
                        'text': personalized_message
                    }
                }
            ]
            
            await send_slack_dm(
                token,
                admin_email,
                blocks,
                f"Daily shift schedule for {formatted_date}"
            )
            sent_to.append(admin_email)
        except Exception as e:
            logging.error(f'Failed to send daily shift notification to {admin_email}: {e}')
            errors.append(f"{admin_email}: {str(e)}")
    
    if test_mode:
        return {
            'ok': True,
            'test_mode': True,
            'sent_to': sent_to,
            'errors': errors,
            'message_preview': message_text
        }
    
    return {
        'ok': True,
        'sent': len(sent_to),
        'sent_to': sent_to,
        'errors': errors if errors else None
    }


# ── Google Sheets export ──────────────────────────────────────────────────────

SPREADSHEET_ID = os.getenv('GOOGLE_SPREADSHEET_ID', '1LE6dRqP1ocDtWWxU2Aoy02GQ-zB8oEC4UWKSRhvezqI')
SHEET_GID = int(os.getenv('GOOGLE_SHEET_GID', '1463131434'))


def _col_idx_to_letter(idx: int) -> str:
    """Convert 0-based column index to spreadsheet letter(s). 0→A, 25→Z, 26→AA …"""
    result = ''
    n = idx
    while True:
        result = chr(65 + n % 26) + result
        n = n // 26 - 1
        if n < 0:
            break
    return result


def _get_sheets_service():
    """
    Build a Google Sheets API client.
    Priority:
      1. FIREBASE_SERVICE_ACCOUNT_B64 env var (same SA used for Firebase Admin)
      2. Application Default Credentials (works automatically on Cloud Run)
    The service account / ADC principal must have at least Editor access to the spreadsheet.
    """
    try:
        from googleapiclient.discovery import build as _goog_build
        from google.oauth2 import service_account as _sa_module
        import google.auth as _gauth
    except ImportError as exc:
        raise RuntimeError(
            "google-api-python-client and google-auth must be installed. "
            "Add them to requirements.txt."
        ) from exc

    scopes = ['https://www.googleapis.com/auth/spreadsheets']
    _sa_b64 = os.getenv('FIREBASE_SERVICE_ACCOUNT_B64', '').strip()
    if _sa_b64:
        sa_info = json.loads(base64.b64decode(_sa_b64).decode('utf-8'))
        creds = _sa_module.Credentials.from_service_account_info(sa_info, scopes=scopes)
    else:
        creds, _ = _gauth.default(scopes=scopes)
    return _goog_build('sheets', 'v4', credentials=creds, cache_discovery=False)


def _compute_employee_hours_for_week(week_start: str) -> dict:
    """
    Read Firebase schedule for *week_start* (YYYY-MM-DD Monday) and return
    per-employee totals keyed by email USERNAME (local part before @).
    e.g. {'dato.lomidze': {'hours': 40.0, 'shifts': 5, 'name': 'Dato Lomidze'}}
    This allows matching against sheet emails regardless of domain (@partner.example.com vs @example.com).
    Employee list is read from Firebase 'teamMembers' node (populated via CSV import in SettingsTab).
    """
    HOURS_PER_SHIFT = 9  # default fallback if start/end datetimes are missing

    sched_data: dict = db.reference(f'schedules/{week_start}').get() or {}
    assignments = sched_data.get('assignments', [])
    if isinstance(assignments, dict):
        assignments = list(assignments.values())

    # Read leaves for this week (stored under schedules/{weekStart}/leaves)
    # Key: (str(employee_id), date_str) → leave dict
    leaves_raw = sched_data.get('leaves', {}) or {}
    if isinstance(leaves_raw, dict):
        leaves_list = list(leaves_raw.values())
    else:
        leaves_list = list(leaves_raw)

    # Build a quick lookup: (employee_id_str, date_str) → list of leaves
    leave_map: dict = {}
    for lv in leaves_list:
        if not isinstance(lv, dict):
            continue
        key = (str(lv.get('employee_id', '')), str(lv.get('date', '')))
        leave_map.setdefault(key, []).append(lv)

    # Build employee id → email username from Firebase 'teamMembers' node
    # This is the live employee list uploaded via CSV in SettingsTab
    employees_raw = db.reference('teamMembers').get() or {}
    id_to_username: dict = {}
    id_to_name: dict = {}

    items = employees_raw.values() if isinstance(employees_raw, dict) else employees_raw
    for emp in items:
        if not isinstance(emp, dict):
            continue
        email = (emp.get('email') or '').strip().lower()
        name = emp.get('name', '')
        emp_id = str(emp.get('id', ''))
        if emp_id:
            if email and '@' in email:
                id_to_username[emp_id] = email.split('@')[0]
            id_to_name[emp_id] = name

    result: dict = {}
    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        emp_id = str(assignment.get('employee_id', ''))
        username = id_to_username.get(emp_id)
        if not username:
            # No email for this employee id in teamMembers — skip
            continue

        # Work hours per shift type — 8h net (1h break excluded), same as DataTab
        SHIFT_HOURS_MAP = {'morning': 8, 'day': 8, 'afternoon': 8, 'night': 8}
        shift_type = assignment.get('shift_type', '')
        if shift_type == 'overtime':
            # Overtime: use actual duration_hours field
            hours = float(assignment.get('duration_hours', HOURS_PER_SHIFT))
        else:
            hours = float(SHIFT_HOURS_MAP.get(shift_type, HOURS_PER_SHIFT))

        # Apply leave deductions (same logic as DataTab)
        start_dt_str = assignment.get('start_datetime', '')
        date_str = assignment.get('date', '') or (start_dt_str[:10] if start_dt_str else '')
        day_leaves = leave_map.get((emp_id, date_str), [])
        all_day_leave = any(lv.get('timeframe') == 'all-day' for lv in day_leaves)
        if all_day_leave:
            # All-day leave: don't count this shift at all (matches DataTab behaviour)
            continue

        partial_leave = next((lv for lv in day_leaves if lv.get('timeframe') != 'all-day'), None)
        if partial_leave:
            shift_hours_for_leave = 8.0  # DataTab uses 8 as base for leave deduction
            timeframe = partial_leave.get('timeframe', '')
            if timeframe in ('first-half', 'second-half'):
                hours = max(0.0, hours - shift_hours_for_leave / 2)
            elif timeframe == 'other':
                cs = partial_leave.get('custom_start', '')
                ce = partial_leave.get('custom_end', '')
                if cs and ce:
                    try:
                        from datetime import datetime as _dt
                        ls = _dt.fromisoformat(f"{date_str}T{cs}")
                        le = _dt.fromisoformat(f"{date_str}T{ce}")
                        deduct = (le - ls).total_seconds() / 3600
                        hours = max(0.0, hours - deduct)
                    except Exception:
                        pass

        if username not in result:
            result[username] = {
                'hours': 0.0,
                'shifts': 0,
                'name': id_to_name.get(emp_id, assignment.get('employee_name', '')),
            }
        result[username]['hours'] += hours
        result[username]['shifts'] += 1

    return result


@app.post("/api/export-to-sheets", tags=["Export"])
async def export_to_sheets(request: Request):
    """
    Export *Worked Hours* and *Total Shifts* into the Google Sheet.

    Auth (either one):
      • Admin Firebase Bearer token  (manual button in the UI)
      • X-Cron-Secret header matching CRON_SECRET env var  (Cloud Scheduler)

    Body (all optional, JSON):
      start_date  YYYY-MM-DD  default = Monday of last completed week
      end_date    YYYY-MM-DD  default = Sunday of last completed week

    The endpoint finds rows where the sheet's email column matches an employee
    email AND the sheet's week column matches the corresponding week-start date,
    then writes the computed values into the 'Worked Hours' and 'Total Shifts'
    columns (created dynamically after the last used header if missing).
    """
    # ── Auth ──────────────────────────────────────────────────────────────────
    cron_secret = os.getenv('CRON_SECRET', '')
    incoming_cron = request.headers.get('X-Cron-Secret', '')
    if not (cron_secret and incoming_cron == cron_secret):
        # Fall back to admin Firebase token check
        verify_admin_access(request)

    # ── Connect to Google Sheets ──────────────────────────────────────────────
    try:
        service = _get_sheets_service()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    sheets_api = service.spreadsheets()

    # Resolve sheet tab name from GID
    try:
        sheet_meta = sheets_api.get(spreadsheetId=SPREADSHEET_ID).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cannot access spreadsheet: {exc}")

    SHEET_NAME_OVERRIDE = 'Finalized Case Metrics'
    sheet_name: Optional[str] = None
    # First try the hardcoded sheet name (case-insensitive, trimmed)
    for s in sheet_meta.get('sheets', []):
        if s['properties']['title'].strip().lower() == SHEET_NAME_OVERRIDE.lower():
            sheet_name = s['properties']['title']
            break
    # Fallback: match by GID
    if not sheet_name:
        for s in sheet_meta.get('sheets', []):
            if s['properties']['sheetId'] == SHEET_GID:
                sheet_name = s['properties']['title']
                break
    if not sheet_name:
        available = [s['properties']['title'] for s in sheet_meta.get('sheets', [])]
        raise HTTPException(status_code=404, detail=f"Sheet '{SHEET_NAME_OVERRIDE}' (GID {SHEET_GID}) not found. Available sheets: {available}")

    # Read all values
    try:
        raw_result = sheets_api.values().get(
            spreadsheetId=SPREADSHEET_ID,
            range=f"'{sheet_name}'"
        ).execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read sheet data: {exc}")

    all_values = raw_result.get('values', [])
    if not all_values:
        raise HTTPException(status_code=404, detail="Sheet is empty")

    # ── Parse header row ──────────────────────────────────────────────────────
    headers_raw: list = list(all_values[0])
    headers_lower = [str(h).strip().lower() for h in headers_raw]

    # Find email column
    email_col: Optional[int] = next(
        (i for i, h in enumerate(headers_lower) if 'email' in h), None
    )
    if email_col is None:
        raise HTTPException(status_code=400, detail="No email column found in header row")

    # Week column is always column F (index 5).
    # If column F doesn't contain a parseable date, _parse_sheet_week returns None
    # and those rows are skipped — date strings like "2026-04-20" work as fallback.
    week_col: int = 5

    # Find or plan 'Worked Hours' column
    worked_hours_col: Optional[int] = next(
        (i for i, h in enumerate(headers_lower)
         if h.replace(' ', '').replace('_', '') in ('workedhours', 'workhours')),
        None
    )

    # Find or plan 'Total Shifts' column
    total_shifts_col: Optional[int] = next(
        (i for i, h in enumerate(headers_lower)
         if h.replace(' ', '').replace('_', '') in ('totalshifts', 'shiftcount', 'shifts')),
        None
    )

    # Determine last occupied header column index
    last_occupied = max(
        (i for i, h in enumerate(headers_lower) if h),
        default=len(headers_lower) - 1
    )

    # Assign new column positions if headers are missing
    header_writes: list = []
    if worked_hours_col is None:
        worked_hours_col = last_occupied + 1
        last_occupied = worked_hours_col
        header_writes.append({
            'range': f"'{sheet_name}'!{_col_idx_to_letter(worked_hours_col)}1",
            'values': [['Worked Hours']]
        })
    if total_shifts_col is None:
        total_shifts_col = last_occupied + 1
        header_writes.append({
            'range': f"'{sheet_name}'!{_col_idx_to_letter(total_shifts_col)}1",
            'values': [['Total Shifts']]
        })

    if header_writes:
        sheets_api.values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={'valueInputOption': 'RAW', 'data': header_writes}
        ).execute()

    # ── Match data rows and build cell updates ────────────────────────────────
    # Step 1: Collect all week dates that appear in the sheet (normalised to YYYY-MM-DD Monday)
    DATE_FORMATS = ('%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y', '%Y/%m/%d')

    def _parse_sheet_week(val: str) -> Optional[str]:
        """Parse a sheet week cell and return the Monday of that week as YYYY-MM-DD, or None."""
        for fmt in DATE_FORMATS:
            try:
                dt = datetime.strptime(val.strip(), fmt)
                # Snap to Monday
                monday = dt - timedelta(days=dt.weekday())
                return monday.strftime('%Y-%m-%d')
            except ValueError:
                continue
        return None

    sheet_week_dates: set = set()
    for row in all_values[1:]:
        if len(row) > week_col:
            ws = _parse_sheet_week(str(row[week_col]))
            if ws:
                sheet_week_dates.add(ws)

    # Step 2: Fetch Firebase schedule data for every week that exists in the sheet
    week_data: dict = {}
    for ws in sheet_week_dates:
        week_data[ws] = _compute_employee_hours_for_week(ws)

    week_starts = sorted(sheet_week_dates)

    # Step 3: Write to matching rows
    cell_updates: list = []
    rows_updated = 0

    for row_idx, row in enumerate(all_values[1:], start=2):  # 1-indexed; row 1 = headers
        if len(row) <= max(email_col, week_col):
            continue

        email_val = str(row[email_col]).strip().lower()
        week_val = str(row[week_col]).strip()

        if not email_val or not week_val:
            continue

        # Normalise the sheet's week cell to the Monday of that week (YYYY-MM-DD)
        week_date_str = _parse_sheet_week(week_val)
        if not week_date_str:
            continue

        # Look up employee data by username (local part before @)
        # Sheet emails may use different domain (@partner.example.com) vs our system (@example.com)
        username = email_val.split('@')[0] if '@' in email_val else email_val
        emp_data = week_data.get(week_date_str, {}).get(username)
        if emp_data is None:
            continue

        wh_range = f"'{sheet_name}'!{_col_idx_to_letter(worked_hours_col)}{row_idx}"
        ts_range = f"'{sheet_name}'!{_col_idx_to_letter(total_shifts_col)}{row_idx}"

        cell_updates.append({'range': wh_range, 'values': [[round(emp_data['hours'], 2)]]})
        cell_updates.append({'range': ts_range, 'values': [[emp_data['shifts']]]})
        rows_updated += 1

    if cell_updates:
        sheets_api.values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={'valueInputOption': 'RAW', 'data': cell_updates}
        ).execute()

    return {
        'success': True,
        'sheet_weeks_found': week_starts,
        'weeks_with_firebase_data': [ws for ws, d in week_data.items() if d],
        'rows_updated': rows_updated,
        'worked_hours_column': _col_idx_to_letter(worked_hours_col),
        'total_shifts_column': _col_idx_to_letter(total_shifts_col),
    }


# ─── Leave Import Webhook ─────────────────────────────────────────────────────

class LeaveImportItem(BaseModel):
    employee_email: str
    start_date: str                     # YYYY-MM-DD
    end_date: str                       # YYYY-MM-DD
    leave_type: str                     # 'sick' | 'annual' | 'unpaid' | etc.
    status: str                         # only 'accepted' records are processed
    timeframe: str                      # 'all-day' | 'first-half' | 'second-half' | 'other'
    custom_start: Optional[str] = None  # HH:MM – required when timeframe='other'
    custom_end: Optional[str] = None    # HH:MM – required when timeframe='other'


def _week_start_for_date(date_str: str) -> str:
    """Return the Monday (YYYY-MM-DD) for any given date string."""
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return (d - timedelta(days=d.weekday())).strftime('%Y-%m-%d')


@app.post("/api/import-leaves", tags=["Leaves"])
async def import_leaves(request: Request, leaves: List[LeaveImportItem]):
    """
    Webhook endpoint for importing accepted leaves from an external HR system.
    Requires X-Webhook-Secret header matching the WEBHOOK_SECRET env var.

    Each leave record is written to Firebase at schedules/{weekStart}/leaves/{newId}
    with source='external'. Duplicate records (same employee_id + date) are skipped.
    Multi-day leaves are expanded into one record per day.
    """
    # ── Auth ──────────────────────────────────────────────────────────────────
    webhook_secret = os.getenv('WEBHOOK_SECRET', '').strip()
    if webhook_secret:
        incoming = request.headers.get('X-Webhook-Secret', '')
        if incoming != webhook_secret:
            raise HTTPException(status_code=401, detail='Unauthorized')

    # ── Build email → employee_id lookup ─────────────────────────────────────
    try:
        employees_raw = db.reference('teamMembers').get() or {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to load teamMembers: {e}')

    email_to_id: dict = {}
    email_to_name: dict = {}  # Also store employee names
    items = employees_raw.values() if isinstance(employees_raw, dict) else employees_raw
    for emp in items:
        if not isinstance(emp, dict):
            continue
        email = (emp.get('email') or '').strip().lower()
        emp_id = emp.get('id')
        emp_name = emp.get('name', '').strip()
        if email and emp_id is not None:
            email_to_id[email] = str(emp_id)
            email_to_name[email] = emp_name

    # ── Process each leave ────────────────────────────────────────────────────
    imported = 0
    deleted = 0
    skipped = 0
    errors: list = []

    VALID_TIMEFRAMES = {'all-day', 'first-half', 'second-half', 'other'}

    ACCEPTED_STATUSES = {'accepted', 'imported'}

    LEAVE_TYPE_MAP = {
        'paid': 'annual',
        'annual': 'annual',
        'sick': 'sick',
        'unpaid': 'unpaid',
        'maternity': 'maternity',
    }

    for item in leaves:
        status_lower = item.status.strip().lower()

        # ── Handle cancellations ─────────────────────────────────────────────
        if status_lower == 'canceled':
            email = item.employee_email.strip().lower()
            emp_id = email_to_id.get(email)
            if not emp_id:
                errors.append(f'No employee found for email: {item.employee_email}')
                skipped += 1
                continue

            incoming_type = item.leave_type.strip().lower()
            leave_type = LEAVE_TYPE_MAP.get(incoming_type, 'annual')

            try:
                start = datetime.strptime(item.start_date, '%Y-%m-%d')
                end = datetime.strptime(item.end_date, '%Y-%m-%d')
            except ValueError as e:
                errors.append(f'Invalid date for {item.employee_email}: {e}')
                skipped += 1
                continue

            if end < start:
                errors.append(
                    f'end_date before start_date for {item.employee_email}: '
                    f'{item.start_date} → {item.end_date}'
                )
                skipped += 1
                continue

            current = start
            while current <= end:
                date_str = current.strftime('%Y-%m-%d')
                week_start = _week_start_for_date(date_str)

                try:
                    existing_leaves_raw = db.reference(f'schedules/{week_start}/leaves').get() or {}
                except Exception as e:
                    errors.append(f'Firebase read error for {item.employee_email} on {date_str}: {e}')
                    skipped += 1
                    current += timedelta(days=1)
                    continue

                existing_leaves_ref = existing_leaves_raw if isinstance(existing_leaves_raw, dict) else {}

                found = False
                for lv_key, lv in existing_leaves_ref.items():
                    if (isinstance(lv, dict)
                            and str(lv.get('employee_id')) == emp_id
                            and lv.get('date') == date_str
                            and lv.get('leave_type') == leave_type):
                        try:
                            db.reference(f'schedules/{week_start}/leaves/{lv_key}').delete()
                            deleted += 1
                            found = True
                            print(f'🗑️  Deleted leave {lv_key} for employee {emp_id} on {date_str} '
                                  f'(leave_type: {leave_type})')
                        except Exception as e:
                            errors.append(
                                f'Firebase delete error for {item.employee_email} on {date_str}: {e}'
                            )
                            skipped += 1
                        break

                if not found:
                    skipped += 1

                current += timedelta(days=1)
            continue

        # Only process accepted/imported leaves
        if status_lower not in ACCEPTED_STATUSES:
            skipped += 1
            continue

        email = item.employee_email.strip().lower()
        emp_id = email_to_id.get(email)
        if not emp_id:
            errors.append(f'No employee found for email: {item.employee_email}')
            skipped += 1
            continue

        # Validate and normalise timeframe
        timeframe = (item.timeframe or 'all-day').strip().lower()
        if timeframe not in VALID_TIMEFRAMES:
            errors.append(
                f'Invalid timeframe "{item.timeframe}" for {item.employee_email} — using all-day'
            )
            timeframe = 'all-day'

        # Map leave_type to current system: paid→annual, sick→sick, unpaid→unpaid, maternity→maternity
        incoming_type = item.leave_type.strip().lower()
        leave_type = LEAVE_TYPE_MAP.get(incoming_type, 'annual')  # Default to 'annual' if unknown
        if incoming_type not in LEAVE_TYPE_MAP:
            errors.append(
                f'Unknown leave type "{item.leave_type}" for {item.employee_email} — mapping to annual'
            )

        # Expand date range into individual dates
        try:
            start = datetime.strptime(item.start_date, '%Y-%m-%d')
            end = datetime.strptime(item.end_date, '%Y-%m-%d')
        except ValueError as e:
            errors.append(f'Invalid date for {item.employee_email}: {e}')
            skipped += 1
            continue

        if end < start:
            errors.append(
                f'end_date before start_date for {item.employee_email}: '
                f'{item.start_date} → {item.end_date}'
            )
            skipped += 1
            continue

        current = start
        while current <= end:
            date_str = current.strftime('%Y-%m-%d')
            week_start = _week_start_for_date(date_str)

            # ── Fetch the employee's actual shift for this date first ──────────
            # Shifts are stored as a flat array at schedules/{week_start}/assignments
            # (not keyed by employee_id), so we load the whole array and filter.
            try:
                assignments_raw = db.reference(f'schedules/{week_start}/assignments').get() or {}
            except Exception as e:
                errors.append(f'Firebase read error (schedule) for {item.employee_email} on {date_str}: {e}')
                skipped += 1
                current += timedelta(days=1)
                continue

            actual_shift = None
            items_iter = assignments_raw.values() if isinstance(assignments_raw, dict) else (assignments_raw if isinstance(assignments_raw, list) else [])
            for shift_data in items_iter:
                if (isinstance(shift_data, dict)
                        and str(shift_data.get('employee_id')) == emp_id
                        and shift_data.get('date') == date_str):
                    actual_shift = shift_data
                    break

            # Determine the correct shift_type and times from the actual shift
            if actual_shift:
                shift_type = actual_shift.get('shift_type', 'day')
                raw_start = actual_shift.get('start_datetime', f'{date_str}T10:00:00+00:00')
                raw_end = actual_shift.get('end_datetime', f'{date_str}T19:00:00+00:00')
                # Strip timezone suffix so +00:00 can be appended consistently
                shift_start_dt = raw_start[:-6] if raw_start.endswith('+00:00') else raw_start
                shift_end_dt = raw_end[:-6] if raw_end.endswith('+00:00') else raw_end
            else:
                # Will auto-create a Day shift below; use its defaults
                shift_type = 'day'
                shift_start_dt = f'{date_str}T10:00:00'
                shift_end_dt = f'{date_str}T19:00:00'

            # ── Check for an existing leave for the same employee+date ─────────
            try:
                existing_leaves_raw = db.reference(f'schedules/{week_start}/leaves').get() or {}
            except Exception as e:
                errors.append(f'Firebase read error for {date_str}: {e}')
                skipped += 1
                current += timedelta(days=1)
                continue

            existing_leaves_ref = (
                existing_leaves_raw
                if isinstance(existing_leaves_raw, dict)
                else {}
            )

            # Find any duplicate leave for this employee+date
            existing_leave_key = None
            existing_leave_record = None
            for lv_key, lv in existing_leaves_ref.items():
                if (isinstance(lv, dict)
                        and str(lv.get('employee_id')) == emp_id
                        and lv.get('date') == date_str):
                    existing_leave_key = lv_key
                    existing_leave_record = lv
                    break

            if existing_leave_record:
                # A leave already exists — always overwrite it with the latest
                # data so re-imports self-heal stale or incorrect records.
                employee_name = email_to_name.get(email, 'Unknown')
                updated_record: dict = {
                    'employee_id': int(emp_id) if emp_id.isdigit() else emp_id,
                    'employee_name': employee_name,
                    'date': date_str,
                    'timeframe': timeframe,
                    'leave_type': leave_type,
                    'shift_type': shift_type,
                    'shift_start': f'{shift_start_dt}+00:00',
                    'shift_end': f'{shift_end_dt}+00:00',
                    'source': 'external',
                    'createdAt': existing_leave_record.get('createdAt', datetime.now(timezone.utc).isoformat()),
                    'updatedAt': datetime.now(timezone.utc).isoformat(),
                    'createdBy': item.employee_email,
                }
                if timeframe == 'other' and item.custom_start and item.custom_end:
                    updated_record['custom_start'] = item.custom_start
                    updated_record['custom_end'] = item.custom_end
                try:
                    db.reference(f'schedules/{week_start}/leaves/{existing_leave_key}').set(updated_record)
                    imported += 1
                    print(f"🔄 Updated existing leave {existing_leave_key} for employee {emp_id} on {date_str} "
                          f"(shift_type: {existing_leave_record.get('shift_type')} → {shift_type})")
                except Exception as e:
                    errors.append(
                        f'Firebase update error for {item.employee_email} on {date_str}: {e}'
                    )
                    skipped += 1
                current += timedelta(days=1)
                continue

            # ── Auto-create a Day shift if none exists ────────────────────────
            # Only applies to all-day leaves; first-half/second-half require
            # an existing shift — skip those days if no shift is found.
            if not actual_shift:
                if timeframe != 'all-day':
                    errors.append(
                        f'No shift found for {item.employee_email} on {date_str} '
                        f'and timeframe is "{timeframe}" (not all-day) — skipped'
                    )
                    skipped += 1
                    current += timedelta(days=1)
                    continue
                # all-day leave with no shift → auto-create a Day shift
                try:
                    employee_name = email_to_name.get(email, 'Unknown')
                    day_shift = {
                        'employee_id': int(emp_id) if str(emp_id).isdigit() else emp_id,
                        'employee_name': employee_name,
                        'date': date_str,
                        'shift_type': 'day',
                        'start_datetime': f'{date_str}T10:00:00+00:00',
                        'end_datetime': f'{date_str}T19:00:00+00:00',
                        'created_from': 'leave_import'
                    }
                    db.reference(f'schedules/{week_start}/assignments').push(day_shift)
                    print(f"✅ Auto-created Day shift for employee {emp_id} ({employee_name}) on {date_str} (all-day leave without existing shift)")
                except Exception as e:
                    errors.append(f'Failed to auto-create shift for {item.employee_email} on {date_str}: {e}')
                    skipped += 1
                    current += timedelta(days=1)
                    continue

            employee_name = email_to_name.get(email, 'Unknown')
            
            leave_record: dict = {
                'employee_id': int(emp_id) if emp_id.isdigit() else emp_id,
                'employee_name': employee_name,
                'date': date_str,
                'timeframe': timeframe,
                'leave_type': leave_type,
                'shift_type': shift_type,
                'shift_start': f'{shift_start_dt}+00:00',
                'shift_end': f'{shift_end_dt}+00:00',
                'source': 'external',
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'createdBy': item.employee_email,
            }
            if timeframe == 'other' and item.custom_start and item.custom_end:
                leave_record['custom_start'] = item.custom_start
                leave_record['custom_end'] = item.custom_end

            try:
                db.reference(f'schedules/{week_start}/leaves').push(leave_record)
                imported += 1
            except Exception as e:
                errors.append(
                    f'Firebase write error for {item.employee_email} on {date_str}: {e}'
                )
                skipped += 1

            current += timedelta(days=1)

    return {'imported': imported, 'deleted': deleted, 'skipped': skipped, 'errors': errors}


# ─── Labor Report / TimeOff Worklog ──────────────────────────────────────────

# Standard shift windows (local time): (start_hour, end_hour_exclusive)
# end_hour > 24 means the shift ends on the next calendar day.
_LABOR_SHIFT_WINDOWS: Dict[str, tuple] = {
    'morning':   (4,  13),   # 04:00–13:00
    'day':       (10, 19),   # 10:00–19:00
    'afternoon': (15, 24),   # 15:00–00:00 (midnight)
    'night':     (19, 28),   # 19:00–04:00 (+1 day)
}

# Night-premium hours per shift type (22:00–06:00 window, Georgian labour law)
_LABOR_SHIFT_NIGHT_HOURS: Dict[str, float] = {
    'morning':   2.0,   # 04:00–06:00 overlap
    'day':       0.0,   # no overlap
    'afternoon': 2.0,   # 22:00–00:00 overlap
    'night':     6.0,   # 22:00–04:00 overlap
}


def _night_overlap_hours(start_dt: Any, end_dt: Any) -> float:
    """
    Compute hours in the night-premium window 22:00–06:00.
    Accepts pendulum DateTime objects (timezone-aware or naive) or stdlib datetime.
    Works correctly for shifts that cross midnight.
    """
    if end_dt <= start_dt:
        return 0.0

    total_secs = 0.0
    one_day = timedelta(days=1)
    # Normalise to midnight of the day containing start_dt
    try:
        # pendulum DateTime API
        day = start_dt.start_of('day')
        end_of_range = end_dt.start_of('day') + one_day
    except AttributeError:
        # stdlib datetime fallback
        day = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt_day = end_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_range = end_dt_day + one_day

    while day < end_of_range:
        # Night window spans two sub-intervals per calendar day:
        #   [00:00–06:00] and [22:00–00:00] (i.e., hours 0-6 and 22-24)
        for h_start, h_end in ((0, 6), (22, 24)):
            n_start = day + timedelta(hours=h_start)
            n_end   = day + timedelta(hours=h_end)
            lo = max(start_dt, n_start)
            hi = min(end_dt, n_end)
            if lo < hi:
                try:
                    total_secs += (hi - lo).total_seconds()
                except Exception:
                    total_secs += (hi - lo).in_seconds()
        day = day + one_day

    return round(total_secs / 3600, 4)


def _compute_shift_hours_breakdown(assignment: dict) -> tuple:
    """
    Return (worked_hours, night_hours) for a single assignment.

    Prefers computing from start_datetime/end_datetime (pendulum-parseable
    ISO strings with timezone offset).  Falls back to the pre-computed
    per-shift-type constants when datetimes are absent or unparseable.
    """
    shift_type = (assignment.get('shift_type') or 'day').lower()

    start_str = assignment.get('start_datetime')
    end_str = assignment.get('end_datetime')

    if start_str and end_str:
        try:
            import pendulum as _pendulum
            start_p = _pendulum.parse(start_str)
            end_p = _pendulum.parse(end_str)
            # Guard against same-day storage errors for cross-midnight shifts
            if end_p <= start_p:
                end_p = end_p.add(days=1)
            worked = (end_p - start_p).total_seconds() / 3600 - 1.0  # deduct 1h break
            worked = max(0.0, worked)
            night_h = _night_overlap_hours(start_p, end_p)
            return round(worked, 4), night_h
        except Exception:
            pass  # fall through to type-based fallback

    # Fallback: use pre-computed windows (subtract 1h break)
    window = _LABOR_SHIFT_WINDOWS.get(shift_type)
    if window:
        start_h, end_h = window
        worked = float(end_h - start_h) - 1.0
    else:
        worked = 8.0
    night_h = float(_LABOR_SHIFT_NIGHT_HOURS.get(shift_type, 0.0))
    return worked, night_h


def _compute_leave_hours_breakdown(leave: dict) -> tuple:
    """
    Return (leave_hours, night_leave_hours) for a single leave record.

    Uses shift_start/shift_end stored on the leave when possible.
    Timeframe rules:
      all-day   → full shift window minus 1h break
      first-half / second-half → 4.0 h (half of 8h paid)
      other     → custom_start..custom_end raw duration (no break deduction)

    night_leave_hours = overlap of leave window with 22:00–06:00,
    capped at leave_hours so day + night always equals leave_hours.
    """
    timeframe  = leave.get('timeframe', 'all-day')
    date_str   = leave.get('date', '')
    shift_type = (leave.get('shift_type') or 'day').lower()

    leave_start = None
    leave_end   = None

    shift_start_str = leave.get('shift_start', '')
    shift_end_str   = leave.get('shift_end', '')

    if shift_start_str and shift_end_str:
        try:
            import pendulum as _pendulum
            shift_s = _pendulum.parse(shift_start_str)
            shift_e = _pendulum.parse(shift_end_str)
            if shift_e <= shift_s:
                shift_e = shift_e.add(days=1)

            if timeframe == 'all-day':
                leave_start, leave_end = shift_s, shift_e
            elif timeframe in ('first-half', 'second-half'):
                paid_secs = (shift_e - shift_s).total_seconds() - 3600  # subtract 1h break
                mid = shift_s.add(seconds=int(paid_secs / 2))
                leave_start, leave_end = (shift_s, mid) if timeframe == 'first-half' else (mid, shift_e)
            elif timeframe == 'other':
                cs = leave.get('custom_start', '')
                ce = leave.get('custom_end', '')
                if cs and ce and date_str:
                    leave_start = _pendulum.parse(f'{date_str}T{cs}:00')
                    leave_end   = _pendulum.parse(f'{date_str}T{ce}:00')
                    if leave_end <= leave_start:
                        leave_end = leave_end.add(days=1)
        except Exception:
            leave_start = leave_end = None

    if leave_start is not None and leave_end is not None:
        raw_hours = (leave_end - leave_start).total_seconds() / 3600
        if timeframe == 'all-day':
            leave_hours = max(0.0, raw_hours - 1.0)  # 1h break deduction
        elif timeframe in ('first-half', 'second-half'):
            leave_hours = 4.0  # half of 8h paid shift
        else:
            leave_hours = max(0.0, raw_hours)  # custom window, no break
        night_h = min(_night_overlap_hours(leave_start, leave_end), leave_hours)
        return round(leave_hours, 4), round(night_h, 4)

    # Fallback using shift-type window constants
    window = _LABOR_SHIFT_WINDOWS.get(shift_type)
    if window:
        start_h, end_h = window
        raw_h = float(end_h - start_h)
        base_night = float(_LABOR_SHIFT_NIGHT_HOURS.get(shift_type, 0.0))
    else:
        raw_h, base_night = 9.0, 0.0

    if timeframe == 'all-day':
        leave_hours = raw_h - 1.0
        night_h = base_night
    elif timeframe in ('first-half', 'second-half'):
        leave_hours = 4.0
        night_h = round(base_night / 2, 4)
    else:
        leave_hours = 4.0
        night_h = round(base_night / 2, 4)

    leave_hours = max(0.0, leave_hours)
    night_h = min(night_h, leave_hours)
    return round(leave_hours, 4), round(night_h, 4)


class LaborReportRequest(BaseModel):
    employee_id: Optional[str] = None
    employee_email: Optional[str] = None
    year: int
    month: int                          # 1–12
    timezone: str = "Asia/Tbilisi"
    aggregation: str = "shift_start_day"


@app.post("/api/labor-report/worklog", tags=["LaborReport"])
async def labor_report_worklog(request: Request, body: LaborReportRequest):
    """
    Return monthly worked-time data for the requested employee, aggregated by
    shift start date.  Cross-midnight shifts (e.g. night 19:00–04:00) are
    credited entirely to the date the shift *started*.

    Authentication: X-Webhook-Secret header — same shared secret used by the
    /api/import-leaves webhook.  Returns 401 if the header is missing and a
    secret is configured; 403 if the secret is present but wrong.
    """
    # ── Authentication ───────────────────────────────────────────────────────
    webhook_secret = os.getenv('WEBHOOK_SECRET', '').strip()
    if webhook_secret:
        incoming = request.headers.get('X-Webhook-Secret', '')
        if not incoming:
            raise HTTPException(status_code=401, detail='Missing X-Webhook-Secret header')
        if incoming != webhook_secret:
            raise HTTPException(status_code=403, detail='Invalid webhook secret')

    # ── Input validation ─────────────────────────────────────────────────────
    if not body.employee_id and not body.employee_email:
        raise HTTPException(
            status_code=400,
            detail='At least one of employee_id or employee_email is required',
        )
    if not (1 <= body.month <= 12):
        raise HTTPException(status_code=400, detail='month must be between 1 and 12')
    if not (2000 <= body.year <= 2100):
        raise HTTPException(status_code=400, detail='year is out of valid range')

    # ── Resolve employee_id from email when only email is supplied ────────────
    emp_id_str: Optional[str] = str(body.employee_id).strip() if body.employee_id else None

    if not emp_id_str and body.employee_email:
        target_email = body.employee_email.strip().lower()
        try:
            employees_raw = db.reference('teamMembers').get() or {}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'Failed to load teamMembers: {e}')

        items_iter: Any = (
            employees_raw.values()
            if isinstance(employees_raw, dict)
            else (employees_raw if isinstance(employees_raw, list) else [])
        )
        for emp in items_iter:
            if not isinstance(emp, dict):
                continue
            email = (emp.get('email') or '').strip().lower()
            if email == target_email:
                emp_id_str = str(emp.get('id', ''))
                break

        if not emp_id_str:
            # Employee exists in the request but not in our system — no data.
            return {'days': []}

    # ── Determine calendar bounds for the requested month ────────────────────
    first_day = datetime(body.year, body.month, 1)
    if body.month == 12:
        last_day = datetime(body.year + 1, 1, 1) - timedelta(days=1)
    else:
        last_day = datetime(body.year, body.month + 1, 1) - timedelta(days=1)

    month_start_str = first_day.strftime('%Y-%m-%d')
    month_end_str = last_day.strftime('%Y-%m-%d')

    # ── Collect all week-start Mondays that overlap the requested month ───────
    first_monday = first_day - timedelta(days=first_day.weekday())
    last_monday = last_day - timedelta(days=last_day.weekday())

    week_starts: list = []
    cur = first_monday
    while cur <= last_monday:
        week_starts.append(cur.strftime('%Y-%m-%d'))
        cur += timedelta(days=7)

    # ── Read assignments and leaves from Firebase ────────────────────────────
    from collections import defaultdict
    day_shifts: Dict[str, list] = defaultdict(list)
    day_leaves: Dict[str, list] = defaultdict(list)  # date → leaves for this employee

    for week_start_str in week_starts:
        try:
            sched_data: dict = db.reference(f'schedules/{week_start_str}').get() or {}
        except Exception as exc:
            logging.warning(f'labor_report: could not read week {week_start_str}: {exc}')
            continue

        assignments = sched_data.get('assignments', [])
        if isinstance(assignments, dict):
            assignments = list(assignments.values())

        for assignment in assignments:
            if not isinstance(assignment, dict):
                continue
            if str(assignment.get('employee_id', '')) != emp_id_str:
                continue

            # Shift start date: prefer the stored `date` field (already in
            # local scheduler timezone), fall back to the ISO datetime prefix.
            date_str: str = assignment.get('date', '')
            if not date_str:
                start_raw = assignment.get('start_datetime', '')
                date_str = start_raw[:10] if start_raw else ''
            if not date_str:
                continue

            # Filter to the requested month
            if date_str < month_start_str or date_str > month_end_str:
                continue

            day_shifts[date_str].append(assignment)

        # Collect leaves for this employee
        leaves_raw = sched_data.get('leaves', {}) or {}
        leaves_list = list(leaves_raw.values()) if isinstance(leaves_raw, dict) else list(leaves_raw)
        for lv in leaves_list:
            if not isinstance(lv, dict):
                continue
            if str(lv.get('employee_id', '')) != emp_id_str:
                continue
            lv_date = lv.get('date', '')
            if not lv_date or lv_date < month_start_str or lv_date > month_end_str:
                continue
            day_leaves[lv_date].append(lv)

    # ── Build one response row per calendar day in the month ─────────────────
    # Generate every date in the requested month so rest days are included.
    all_dates: list = []
    cur_day = first_day
    while cur_day <= last_day:
        all_dates.append(cur_day.strftime('%Y-%m-%d'))
        cur_day += timedelta(days=1)

    days: list = []
    for date_str in all_dates:
        # Compute leave totals for this date regardless of shift presence
        total_leave = 0.0
        total_night_leave = 0.0
        for lv in day_leaves.get(date_str, []):
            lh, nlh = _compute_leave_hours_breakdown(lv)
            total_leave += lh
            total_night_leave += nlh
        total_day_leave = max(0.0, round(total_leave - total_night_leave, 4))
        total_night_leave = round(total_night_leave, 4)
        total_leave = round(total_leave, 4)

        if date_str not in day_shifts:
            days.append({
                'date': date_str,
                'worked_hours': 0.0,
                'day_hours': 0.0,
                'night_hours': 0.0,
                'overtime_hours': 0.0,
                'rest_holiday_worked_hours': 0.0,
                'other_worked_hours': 0.0,
                'is_rest_day': True,
                'leave_hours': total_leave,
                'day_leave_hours': total_day_leave,
                'night_leave_hours': total_night_leave,
            })
            continue

        total_worked = 0.0
        total_night = 0.0
        total_overtime = 0.0
        # rest_holiday and other are placeholders — extend when holiday data
        # is available in the Firebase schema.
        total_rest_holiday = 0.0
        total_other = 0.0

        for assignment in day_shifts[date_str]:
            shift_type = (assignment.get('shift_type') or 'day').lower()

            if shift_type == 'overtime':
                hours = float(assignment.get('duration_hours') or 0)
                total_worked += hours
                total_overtime += hours
            else:
                worked_h, night_h = _compute_shift_hours_breakdown(assignment)
                total_worked += worked_h
                total_night += night_h

        total_day = max(
            0.0,
            total_worked - total_night - total_overtime - total_rest_holiday - total_other,
        )

        # Re-split leave hours using the shift's actual paid day/night structure.
        # The fill order depends on which premium window comes first chronologically:
        #   morning (04–13): night window first (04–06), then day → first-half fills night first
        #   day/afternoon/night: day window comes before night → first-half fills day first
        # second-half always uses the opposite order from first-half.
        if total_leave > 0 and total_worked > 0:
            # Detect temporal order from the primary shift type
            primary_type = ''
            if day_shifts.get(date_str):
                primary_type = (day_shifts[date_str][0].get('shift_type') or '').lower()
            starts_in_night = primary_type == 'morning'  # only morning begins in the 22–06 window

            new_day_leave = 0.0
            new_night_leave = 0.0
            for lv in day_leaves.get(date_str, []):
                lh, _ = _compute_leave_hours_breakdown(lv)
                tf = lv.get('timeframe', 'all-day')
                if tf == 'first-half':
                    if starts_in_night:
                        # Night hours come first → fill night first
                        n = min(lh, total_night)
                        d = lh - n
                    else:
                        # Day hours come first → fill day first
                        d = min(lh, total_day)
                        n = lh - d
                elif tf == 'second-half':
                    if starts_in_night:
                        # Day hours come last → fill day first for second half
                        d = min(lh, total_day)
                        n = lh - d
                    else:
                        # Night hours come last → fill night first for second half
                        n = min(lh, total_night)
                        d = lh - n
                else:
                    # all-day / other: split proportionally to shift's paid ratio
                    d = lh * total_day / total_worked
                    n = lh - d
                new_day_leave += d
                new_night_leave += n
            total_day_leave = round(new_day_leave, 4)
            total_night_leave = round(new_night_leave, 4)

        days.append({
            'date': date_str,
            'worked_hours': round(total_worked, 4),
            'day_hours': round(total_day, 4),
            'night_hours': round(total_night, 4),
            'overtime_hours': round(total_overtime, 4),
            'rest_holiday_worked_hours': round(total_rest_holiday, 4),
            'other_worked_hours': round(total_other, 4),
            'is_rest_day': False,
            'leave_hours': total_leave,
            'day_leave_hours': total_day_leave,
            'night_leave_hours': total_night_leave,
        })

    return {'days': days}


# For running locally
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)