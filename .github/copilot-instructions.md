# CS Scheduler - 24/7 Customer Support Shift Scheduler

Full-stack web application for scheduling 24/7 customer support shifts using constraint-based optimization (Google OR-Tools CP-SAT) with real-time Firebase database, admin controls, and employee self-service features.

## ⚠️ CRITICAL: DO NOT BREAK EXISTING SYSTEMS

**Before making ANY changes, understand these are production systems:**

### MUST NOT MODIFY:
- **Firebase Project ID**: `cs-scheduler-app` (used in all auth, database, and hosting)
- **Firebase Database URL**: `https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app`
- **Firebase Hosting URLs**: `https://cs-scheduler-app.web.app` or `https://cs-scheduler-app.firebaseapp.com`
- **Google Cloud Project ID**: `industrial-gist-470307-k4` (for Cloud Run)
- **Cloud Run Service Name**: `cs-scheduler-io-v2` (region: europe-west1)
- **Cloud Run Backend URL**: `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/`
- **Admin Users List**: `kordzadze2002@gmail.com`, `nino.gogoladze@example.com`, `giga.melikidze@example.com`
- **Google OAuth Domain Restriction**: `example.com` (set in GoogleAuthProvider)
- **CORS Origins**: Must include Firebase Hosting URLs, Cloud Run frontend, and localhost for dev

**IF YOU NEED TO:**
- Create new Firebase projects → **ASK FIRST**
- Deploy to different Cloud Run region → **ASK FIRST**
- Change admin users → **VERIFY EXACT EMAILS AND TEST THOROUGHLY**
- Modify database paths → **DOCUMENT IN THIS FILE**

---

## Tech Stack

### Frontend
- **Framework**: React 18 with Vite (build tool)
- **Styling**: Tailwind CSS with PostCSS
- **Animation**: Framer Motion
- **Date Handling**: date-fns + Pendulum (Python)
- **Backend Communication**: Fetch API
- **State Management**: React Context (AuthContext)
- **Email**: EmailJS for swap request notifications
- **Hosting**: Firebase Hosting (`cs-scheduler-app`)
- **Dev Server**: Vite dev server (localhost:3000, HMR enabled)

### Backend
- **Framework**: FastAPI (Python)
- **Constraint Solver**: Google OR-Tools CP-SAT
- **Database**: Firebase Realtime Database (not Cloud Firestore)
- **Authentication**: Firebase Admin SDK + Google OAuth tokens
- **Deployment**: Google Cloud Run (europe-west1)
- **Environment**: Python 3.10+

### Infrastructure
- **Firebase Project**: `cs-scheduler-app`
  - Authentication (Google OAuth)
  - Realtime Database (europe-west1)
  - Hosting (frontend)
- **Google Cloud**: Project `industrial-gist-470307-k4`
  - Cloud Run: `cs-scheduler-io-v2` service

---

## Project Structure

```
cs-scheduler-io-v2/
├── scheduler.py                     # OR-Tools CP-SAT constraint solver (SINGLE source of truth)
├── Dockerfile                       # Cloud Run container (Python 3.12 + FastAPI)
├── cloudbuild.yaml                  # Cloud Build pipeline (build → push → deploy)
├── requirements.txt                 # Python dependencies
├── pyproject.toml                   # Python project metadata
├── firebase.json                    # Firebase Hosting config (serves scheduler-ui/dist/)
├── database.rules.json              # Firebase RTDB security rules
├── README.md                        # Project overview
│
├── functions/                       # Backend API layer
│   └── api_fastapi.py              # FastAPI endpoints (imports scheduler.py from root)
│
├── scheduler-ui/                    # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx                 # Main app component
│   │   ├── components/             # React components
│   │   │   ├── WeekGrid.jsx        # Main schedule view (by-employee and by-shift modes)
│   │   │   ├── MyPage.jsx          # Employee personal schedule page
│   │   │   ├── DataTab.jsx         # Admin data management
│   │   │   ├── RequestTab.jsx      # Swap request management
│   │   │   ├── ShiftCard.jsx       # Individual shift component
│   │   │   └── MonthCalendar.jsx   # Calendar view for week selection
│   │   ├── contexts/
│   │   │   └── AuthContext.jsx     # Firebase auth + admin status management
│   │   ├── services/
│   │   │   ├── lazyFirebase.js     # Firebase config (project: cs-scheduler-app)
│   │   │   ├── firebaseService.js  # Auth operations
│   │   │   ├── firebaseDatabase.js # RTDB operations
│   │   │   ├── api.js              # Backend API calls
│   │   │   └── emailService.js     # EmailJS integration
│   │   ├── styles/
│   │   │   └── globals.css         # Tailwind imports
│   │   └── utils/
│   │       ├── dateHelpers.js      # Date formatting
│   │       └── cache.js            # Admin email caching (15 min TTL)
│   ├── vite.config.js              # Vite configuration
│   ├── tailwind.config.js          # Tailwind setup
│   └── package.json
│
├── tests/                           # All test files
│   ├── test_scheduler.py
│   ├── test_consecutive_nights.py
│   └── ...
│
├── scripts/                         # Utility scripts (local dev/debugging)
│   ├── generate.py                 # Schedule generation CLI
│   ├── diagnose_infeasibility.py   # Debug infeasible specs
│   └── ...
│
├── examples/                        # Firebase service account key (gitignored)
├── tools/                           # compute_week_summary.py
└── .github/
    └── copilot-instructions.md     # This file (primary documentation)
```

**Architecture Note**: `functions/api_fastapi.py` imports `from scheduler import build_model_and_solve`. In the Docker container, Python resolves this to `/app/scheduler.py` (the root file). There is only ONE scheduler.py — no copies or duplicates.

---

## Key Features & Architecture

### 1. Core Scheduling Engine
- **Shifts (24/7 Coverage)**:
  - Morning: 04:00–13:00 (1 staff minimum)
  - Day: 10:00–19:00 (2-4 staff)
  - Afternoon: 15:00–00:00 (2-4 staff)
  - Night: 19:00–04:00 (2-5 staff)

- **Hard Constraints**:
  - 12-hour minimum rest between all shifts (strictly enforced)
  - Exactly `5 - leave_count` shifts per employee per week (leave_count = all-day leaves)
  - Maximum 1 shift per employee per day
  - Coverage requirements per shift (min_staff ≤ assigned ≤ max_staff)
  - Cross-week rest via prior assignments
  - No overlapping shifts for same employee
  - **Employee day_offs**: Blocks entire days (array of YYYY-MM-DD dates)

### 2. Pre-Assigned Shifts (Preserve Existing Assignments)
- **Feature**: When generating a new schedule, the system preserves any manually-added shifts from the current week
- **Mechanism**:
  - Admin can manually add/remove shifts in the WeekGrid before generating a new schedule
  - When clicking "Generate Schedule", existing assignments are locked as `pre_assigned_shifts`
  - Scheduler MUST include these locked shifts in the final schedule (hard constraint: `x == 1`)
  - Locked shifts are excluded if they:
    - Conflict with a selected employee break day (day_off)
    - Correspond to an employee's all-day leave (would count toward coverage but employee won't work)
- **Data Flow**:
  1. Frontend loads current week's schedule from Firebase (explicit load in `handleGenerateClick`)
  2. Stores loaded data in `currentWeekDataForGeneration` state
  3. Modal button passes state to `generateNewSchedule` as parameter
  4. Extracts existing assignments and filters out conflicts with day_offs and leaves
  5. Builds `pre_assigned_shifts` list and includes in spec to backend
  6. Backend normalizes and validates pre-assigned shifts, then locks them as hard constraints
  7. Solver respects locked shifts and builds around them
- **Important**: Race condition was fixed on May 1, 2026 — `currentWeekData` is now passed as parameter through React state to `generateNewSchedule` function

### 3. Authentication & Authorization
- **OAuth**: Google OAuth with domain restriction (`example.com`)
- **Admin Users** (hardcoded + Firebase backup):
  - `kordzadze2002@gmail.com`
  - `nino.gogoladze@example.com`
  - `giga.melikidze@example.com`
- **Flow**:
  1. User signs in with Google (AuthContext)
  2. Firebase verifies token
  3. Backend checks email against ADMIN_USERS set
  4. Admin status cached (15-min TTL) to reduce Firebase reads
  5. Cache invalidated on app init + manual reload

### 4. Scheduler Visibility Control (Per-Week)
- **Feature**: Admins can hide/unhide specific weeks from employees
- **Storage**: Firebase RTDB at `admin/hidden_weeks/{YYYY-MM-DD}`
- **Behavior**:
  - **Admins**: See all shifts + "🚫 HIDDEN" badge in header
  - **Employees on hidden week**: See one centered message: "The shift is being finalized. Please wait for an update"
  - **Employees on visible week**: See normal schedule
- **Implementation** (WeekGrid.jsx):
  - Load visibility state on week change (useEffect depends on [weekStart])
  - Show/hide toggle in Schedule dropdown menu
  - Badge appears inline with week title
  - Grid entirely replaced (not individual cells) when hidden

### 4. Employee Break Days (day_offs)
- **Feature**: Employees select days off during schedule generation
- **Storage**: Employee object contains `day_offs: [YYYY-MM-DD, ...]`
- **Scheduler Constraint**: Prevents assignment on any day in day_offs array
- **Implementation**:
  - Frontend: Date picker in DataTab for pre-schedule configuration
  - Backend: Loop in scheduler.py adds constraints for each day_off
  - Type: `Optional[List[str]]` in Employee dataclass

### 5. Swap Requests (with Duplicate Prevention)
- **Feature**: Employees request shift swaps
- **Storage**: Firebase RTDB at `swap-requests/{requestId}`
- **Duplicate Prevention**: 
  - Button state `isSubmittingSwapRequest` prevents re-clicks
  - Button disabled during submission with "Submitting..." text
  - Finally block resets state after API response
- **Flow**:
  1. Employee selects two shifts to swap
  2. Click "Confirm Swap Request" (button disabled if already submitting)
  3. Request sent to backend
  4. Button text changes to "Submitting..."
  5. Only one request processed (not duplicates from rapid clicks)

### 6. Daily Slack Shift Notifications
- **Feature**: Automated daily shift summaries sent to admins via Slack DMs at 9:00 AM Asia/Tbilisi time
- **Storage**: Firebase RTDB at `admin/slack_notification_settings`
- **Configuration** (Settings tab):
  - Enable/disable toggle
  - Notification time: **Fixed at 9:00 AM** (configured in Cloud Scheduler, not editable from UI)
  - Weekend notification toggle
  - Admin-employee assignments (for 1:1 catchup suggestions)
  - Test notification button (sends only to kordzadze2002@gmail.com)
- **Message Format**:
  - Personalized greeting with admin's first name
  - Shows all shifts organized by type (Morning, Day, Afternoon, Night)
  - Includes employees on leave with timeframe (Full Day, First Half, Second Half)
  - **1:1 Catchup Suggestions**: Shows manager's assigned employees with shift overlap windows:
    - Morning Window: 10:00 AM - 1:00 PM
    - Full Day Window: 10:00 AM - 7:00 PM
    - Afternoon Window: 3:00 PM - 7:00 PM
    - Excludes employees on leave
    - Night shift employees skipped (no overlap)
  - Formatted with emojis and clear structure
- **Implementation**:
  - Frontend: Settings UI in SettingsTab.jsx
  - Backend: `/api/send-daily-shifts` endpoint in api_fastapi.py
  - Scheduler: Google Cloud Scheduler job `daily-shift-notifications` triggers daily at 9:00 AM
  - Authentication: OIDC token from Cloud Scheduler service account OR Firebase admin token
- **Setup**: See [docs/slack-daily-notifications-setup.md](../docs/slack-daily-notifications-setup.md)

---

## Firebase Realtime Database Schema

```
cs-scheduler-app/
├── schedules/
│   └── {weekStart}/                    # YYYY-MM-DD format
│       ├── {employeeId}/
│       │   ├── {shiftIndex}
│       │   └── ...
│       └── ...
├── admin/
│   ├── hidden_weeks/
│   │   └── {YYYY-MM-DD}: true         # Week is hidden from employees
│   ├── admin-emails: [...]             # Cached admin list
│   ├── slack_notification_settings/    # Daily Slack notification config
│   │   ├── enabled: boolean
│   │   ├── notificationTime: "HH:MM"
│   │   ├── notifyOnWeekends: boolean
│   │   └── adminAssignments: { adminEmail: [employeeId, ...] }
│   └── slack_config/
│       └── bot_token: "xoxb-..."       # Slack bot token
├── employees/
│   └── {employeeId}/
│       ├── name
│       ├── day_offs: [YYYY-MM-DD, ...]
│       └── ...
├── swap-requests/
│   └── {requestId}/
│       ├── employee_id
│       ├── shift1_id
│       ├── shift2_id
│       ├── status
│       └── timestamp
└── [other paths]
```

---

## API Endpoints

### POST `/api/generate-schedule`
- **Auth**: Requires valid Firebase token + admin status
- **Body**: `{ week_start: "YYYY-MM-DD", employees: [...], shift_definitions: {...} }`
- **Returns**: Schedule object or error
- **Admin Check**: Backend verifies token, extracts email, checks against ADMIN_USERS

### POST `/api/send-daily-shifts`
- **Auth**: Requires valid Firebase token + admin status (or Cloud Scheduler OIDC)
- **Body**: `{ test_mode: boolean, date: "YYYY-MM-DD" }` (both optional)
- **Returns**: `{ ok: true, sent_to: [...], errors: [...] }`
- **Usage**: Called by Cloud Scheduler or manually for testing
- **Behavior**: Loads today's schedule, formats message, sends Slack DMs to admins

### GET/POST `/api/...`
- All endpoints verified against Firebase token
- CORS allows Firebase Hosting, Cloud Run frontend, localhost

---

## Deployment Instructions

### Frontend (React + Vite)
```bash
# Development
cd scheduler-ui
npm run dev                           # Starts on localhost:3000, HMR enabled

# Production
npm run build                         # Creates dist/ directory
cd ..
firebase deploy --only hosting        # Deploys to cs-scheduler-app.web.app
```

### Backend (FastAPI on Cloud Run)
```bash
# Build and deploy to Cloud Run (from project root)
gcloud builds submit --region=europe-west1 --project=industrial-gist-470307-k4

# This uses cloudbuild.yaml which:
# 1. Builds Docker image from root Dockerfile
# 2. Pushes to Artifact Registry (europe-west1)
# 3. Deploys to Cloud Run service cs-scheduler-io-v2
```

---

## Potential Issues & Solutions

### Admin Access Issues
- **Symptom**: Admin gets HTTP 403 when generating schedules
- **Causes**:
  1. Email not in ADMIN_USERS set (functions/api_fastapi.py lines 51-56)
  2. Cache not invalidated (admin email cache has 15-min TTL)
  3. Firebase token validation fails
- **Solutions**:
  1. Verify email exact spelling in ADMIN_USERS
  2. Deploy backend with updated ADMIN_USERS
  3. Manually reload admin emails in UI or wait 15 minutes
  4. Check browser console for token errors

### Scheduler Visibility Not Working
- **Symptom**: Employee still sees shifts on hidden week
- **Causes**:
  1. isAdmin not set correctly (check AuthContext DEFAULT_ADMIN_USERS)
  2. Week visibility not saved in Firebase (admin/hidden_weeks/{weekStart})
  3. Stale Cache: employee logged in before admin hid week
- **Solutions**:
  1. Verify user is non-admin in browser console (`window.isAdmin`)
  2. Check Firebase RTDB at admin/hidden_weeks/ path
  3. Have employee hard-refresh (Cmd+Shift+R) or re-login

### Employee day_offs Not Enforced
- **Symptom**: Employee scheduled on break day
- **Causes**:
  1. day_offs array not sent from frontend
  2. Scheduler constraint not applied (check scheduler.py lines ~515-520)
  3. Employee object missing day_offs field
- **Solutions**:
  1. Verify day_offs in request body (check Network tab)
  2. Check scheduler.py has constraint loop for day_offs
  3. Verify Employee dataclass includes `day_offs: Optional[List[str]]`

### Pre-Assigned Shifts Not Being Locked
- **Symptom**: Existing assignments are being replaced instead of preserved during generation
- **Causes**:
  1. **Race condition** (FIXED May 1, 2026): `currentWeekData` not passed to `generateNewSchedule` - now uses state variable to pass it through modal button
  2. Current week's schedule not loaded from Firebase before building spec
  3. Pre-assigned shifts filtered out due to leave or day_off conflicts (check console logs)
  4. Backend received empty `pre_assigned_shifts` array
- **Solutions**:
  1. Check browser console for debug logs: "Pre-assigned shifts to lock: X"
  2. If count is 0, check if any pre-assigned shifts were filtered (look for 🚫 exclusion logs)
  3. Verify existingAssignments are being loaded (check Network tab in DevTools)
  4. If admin manually added shifts but they're not showing, refresh page and try again
  5. Check backend logs for validation errors: `gcloud run logs read cs-scheduler-io-v2 ...`
- **Implementation Details (FIXED)**:
  - `handleGenerateClick` loads current week data and stores in `currentWeekDataForGeneration` state
  - Modal button passes this state to `generateNewSchedule` function
  - `generateNewSchedule` now receives `currentWeekDataParam` and uses it to build `pre_assigned_shifts`
  - No more ReferenceError about undefined `currentWeekData`

### Duplicate Swap Requests
- **Symptom**: Multiple identical swap requests from one click
- **Causes**:
  1. isSubmittingSwapRequest state not updated (App.jsx line 137)
  2. Button not disabled during submission
  3. API response slow (user clicks multiple times)
- **Solutions**:
  1. Check state is set to true before API call
  2. Verify button className includes `disabled:opacity-50` or similar
  3. Button text should show "Submitting..." while pending

### Cache Issues (Admin Emails)
- **Symptom**: New admin can't access even after adding email
- **Cause**: Admin email cache (15-min TTL) not invalidated
- **Solution**: 
  1. Add `cache.invalidate('adminEmails')` on app init (done in AuthContext.jsx line 46)
  2. Or clear browser localStorage manually
  3. Or wait 15 minutes for auto-expiry

### Firebase Connection Issues
- **Symptom**: Can't load schedules or save changes
- **Cause**: Network error or Firebase RTDB offline
- **Check**:
  1. Verify Firebase config in lazyFirebase.js (project ID: cs-scheduler-app)
  2. Check CORS origins include your frontend URL
  3. Verify RTDB region: europe-west1
- **Solution**: Hard refresh browser, check Firebase console for real-time updates

---

## Testing & Verification

### Local Dev
```bash
cd scheduler-ui
npm run dev                     # Dev server on localhost:3000
# Test: Login → toggle weeks → hide week → switch to employee mode
```

### Backend Testing
```bash
# From project root (with venv activated)
python -m pytest tests/            # Run all tests
python scheduler.py --help         # CLI usage
```

### Deployment Verification
1. Check Firebase Hosting: `https://cs-scheduler-app.web.app`
2. Check Cloud Run: `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/docs`
3. Verify admin can generate schedules
4. Verify employees see hidden week message
5. Verify day_offs enforced

---

## Common Tasks

### Add New Admin User
1. Edit `functions/api_fastapi.py` lines 51-56 (ADMIN_USERS set)
2. Add email to DEFAULT_ADMIN_USERS in `scheduler-ui/src/contexts/AuthContext.jsx` line 14
3. Deploy backend: `gcloud builds submit --region=europe-west1 --project=industrial-gist-470307-k4`
4. Deploy frontend: `firebase deploy --only hosting`
5. New admin should be able to login immediately (may need browser refresh)

### Hide/Show a Week
1. Login as admin
2. Go to Schedule tab
3. Select week
4. Click "Schedule" dropdown → "Hide Scheduler" / "Show Scheduler"
5. See "🚫 HIDDEN" badge appear/disappear in header
6. Logout and login as employee to verify message appears

### Add Employee Break Days
1. Go to Data tab (admin only)
2. Select employee
3. Click date picker for break days
4. Select dates (YYYY-MM-DD format stored in Firebase)
5. Generate new schedule
6. Scheduler will skip those days for that employee

### Verify Backend Deployment
```bash
# Check Cloud Run logs
gcloud run logs read cs-scheduler-io-v2 \
  --region=europe-west1 \
  --project=industrial-gist-470307-k4 \
  --limit=50

# Test backend health
curl https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/health
```

---

## Important Files to Know

| File | Purpose | Critical Details |
|------|---------|------------------|
| `scheduler.py` | OR-Tools CP-SAT solver | Constraints, shift definitions, day_offs, leave_count logic |
| `functions/api_fastapi.py` | FastAPI backend | ADMIN_USERS set, CORS origins, Firebase init |
| `scheduler-ui/src/App.jsx` | Main React app | Schedule generation, leave handling, pre-assignment logic |
| `scheduler-ui/src/contexts/AuthContext.jsx` | Auth + admin status | DEFAULT_ADMIN_USERS, cache invalidation |
| `scheduler-ui/src/services/lazyFirebase.js` | Firebase config | Project ID, database URL, OAuth domain |
| `scheduler-ui/src/components/WeekGrid.jsx` | Main schedule view | Visibility logic, hidden message rendering |
| `scheduler-ui/src/services/firebaseDatabase.js` | RTDB operations | Week visibility read/write (admin/hidden_weeks/) |
| `.github/copilot-instructions.md` | This file | Update when adding new features or changing infrastructure |

---

## Last Updated
June 11, 2026 (Added daily Slack shift notifications feature with Settings UI, backend endpoint, and Cloud Scheduler integration)
