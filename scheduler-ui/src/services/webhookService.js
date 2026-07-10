/**
 * Webhook Service
 * Writes schedule + leave data directly to Firestore in the your-kpi-project-id project
 * via the Firestore REST API whenever a shift or leave is saved or deleted.
 *
 * Destination: projects/your-kpi-project-id/databases/(default)/documents/scheduleWebhooks/{weekStart}
 *
 * The Firestore document contains both the raw data AND the fully-computed
 * table that mirrors CS Scheduler's Data tab exactly (rows + summary stats).
 *
 * NOTE: The API key below is a standard Firebase Web API key (safe to include in
 * frontend code). Access is controlled by Firestore security rules on your-kpi-project-id.
 */

import { fetchHolidaysForRange } from './holidayService';
import getFirebase from './lazyFirebase';
import { ref, get } from 'firebase/database';

const FIREBASE_PROJECT = 'your-kpi-project-id';
const API_KEY = 'YOUR_FIREBASE_API_KEY';

function _firestoreUrl(weekStart) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/scheduleWebhooks/${weekStart}?key=${API_KEY}`;
}

// ─── Employee loader ──────────────────────────────────────────────────────────
async function _loadEmployees() {
  try {
    const { db } = await getFirebase();
    const snap = await get(ref(db, 'teamMembers'));
    const raw = snap.val();
    if (!raw) return [];
    return Object.values(raw).filter(e => e && e.id != null);
  } catch (err) {
    console.warn('webhookService: failed to load employees', err);
    return [];
  }
}

// ─── Table computation (mirrors DataTab employeeHours + summaryStats exactly) ─
const _roundHours = (h) => Math.round(h * 100) / 100;
const HOURS_PER_SHIFT = 8;
const BONUS_ELIGIBLE_SHIFTS = ['morning', 'afternoon', 'night'];
const SHIFT_HOURS = { morning: 8, day: 8, afternoon: 8, night: 8 };

function _emptyRow(id, name, isRemoved = false) {
  return {
    id,
    name,
    isRemoved,
    totalHours: 0,
    totalShifts: 0,
    bonusShifts: 0,
    overtimeHours: 0,
    overtimeShifts: 0,
    holidayHours: 0,
    holidayShifts: 0,
    leaveHours: 0,
    paidLeaveHours: 0,
    unpaidLeaveHours: 0,
    leaveCount: 0,
    shiftsByType: {
      morning:   { count: 0, hours: 0 },
      day:       { count: 0, hours: 0 },
      afternoon: { count: 0, hours: 0 },
      night:     { count: 0, hours: 0 },
      overtime:  { count: 0, hours: 0 },
    },
  };
}

async function computeTableData(weekStart, assignments, leaves) {
  const employees = await _loadEmployees();

  // Build holiday map for the week
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);
  let holidayMap = new Map();
  try {
    holidayMap = await fetchHolidaysForRange(weekStart, weekEndDate.toISOString().slice(0, 10));
  } catch (_) { /* holidays optional */ }

  // Normalize employee_id to string for consistent matching
  const normalizeId = (id) => String(id);

  // Seed rows from current employee list
  const hoursData = {};
  employees.forEach(emp => {
    hoursData[normalizeId(emp.id)] = _emptyRow(emp.id, emp.name, false);
  });

  // Process assignments
  assignments.forEach(assignment => {
    const empId = normalizeId(assignment.employee_id);
    if (!hoursData[empId]) {
      hoursData[empId] = _emptyRow(
        assignment.employee_id,
        assignment.employee_name || `Employee ${assignment.employee_id}`,
        true
      );
    }

    let hours = HOURS_PER_SHIFT;
    if (assignment.shift_type === 'overtime') {
      hours = parseFloat(assignment.duration_hours || 0);
    }

    const isBonus = BONUS_ELIGIBLE_SHIFTS.includes(assignment.shift_type) && assignment.shift_type !== 'overtime';
    const dateStr = assignment.date || (assignment.start_datetime ? assignment.start_datetime.slice(0, 10) : '');

    const hasAllDayLeave = leaves.some(l =>
      normalizeId(l.employee_id) === empId && l.date === dateStr && l.timeframe === 'all-day'
    );
    const isHoliday = holidayMap.has(dateStr) && !hasAllDayLeave;

    const partialLeave = leaves.find(l =>
      normalizeId(l.employee_id) === empId && l.date === dateStr && l.timeframe !== 'all-day'
    );

    let workHours = hours;
    if (hasAllDayLeave) {
      workHours = 0;
    } else if (partialLeave) {
      const shiftH = SHIFT_HOURS[assignment.shift_type] || 8;
      let deduct = 0;
      if (partialLeave.timeframe === 'first-half' || partialLeave.timeframe === 'second-half') {
        deduct = shiftH / 2;
      } else if (partialLeave.timeframe === 'other' && partialLeave.custom_start && partialLeave.custom_end) {
        try {
          const s = new Date(`${partialLeave.date}T${partialLeave.custom_start}`);
          const e = new Date(`${partialLeave.date}T${partialLeave.custom_end}`);
          deduct = (e - s) / 3_600_000;
        } catch (_) { deduct = 0; }
      }
      workHours = Math.max(0, hours - deduct);
    }

    if (!hasAllDayLeave) {
      hoursData[empId].totalHours     = _roundHours(hoursData[empId].totalHours + workHours);
      hoursData[empId].totalShifts   += 1;
      if (assignment.shift_type === 'overtime') {
        hoursData[empId].overtimeHours  = _roundHours(hoursData[empId].overtimeHours + workHours);
        hoursData[empId].overtimeShifts += 1;
      } else if (isBonus) {
        hoursData[empId].bonusShifts += 1;
      }
      if (isHoliday) {
        hoursData[empId].holidayHours  = _roundHours(hoursData[empId].holidayHours + workHours);
        hoursData[empId].holidayShifts += 1;
      }
      if (hoursData[empId].shiftsByType[assignment.shift_type]) {
        hoursData[empId].shiftsByType[assignment.shift_type].count  += 1;
        hoursData[empId].shiftsByType[assignment.shift_type].hours   =
          _roundHours(hoursData[empId].shiftsByType[assignment.shift_type].hours + workHours);
      }
    }
  });

  // Process leaves (mirrors DataTab monthlyLeaves forEach)
  leaves.forEach(leave => {
    // Count all leaves regardless of whether there's a matching assignment on the same date
    // (employees can take paid leave on days they're not scheduled to work)
    const empId = normalizeId(leave.employee_id);
    if (!hoursData[empId]) return;

    const shiftPaidHours = SHIFT_HOURS[leave.shift_type] || 8;
    let leaveHours = 0;

    if (leave.timeframe === 'all-day') {
      leaveHours = shiftPaidHours;
    } else if (leave.timeframe === 'first-half' || leave.timeframe === 'second-half') {
      leaveHours = shiftPaidHours / 2;
    } else if (leave.timeframe === 'other' && leave.custom_start && leave.custom_end) {
      try {
        const s = new Date(`${leave.date}T${leave.custom_start}`);
        const e = new Date(`${leave.date}T${leave.custom_end}`);
        leaveHours = (e - s) / 3_600_000;
      } catch (_) { leaveHours = 0; }
    }

    leaveHours = Math.max(0, _roundHours(leaveHours));
    const isPaid = leave.leave_type !== 'unpaid';

    hoursData[empId].leaveHours = _roundHours(hoursData[empId].leaveHours + leaveHours);
    if (isPaid) {
      hoursData[empId].paidLeaveHours = _roundHours(hoursData[empId].paidLeaveHours + leaveHours);
    } else {
      hoursData[empId].unpaidLeaveHours = _roundHours(hoursData[empId].unpaidLeaveHours + leaveHours);
    }
    hoursData[empId].leaveCount += 1;
  });

  const rows = Object.values(hoursData);

  // Summary cards (mirrors DataTab summaryStats)
  const summary = {
    totalHours:          _roundHours(rows.reduce((s, e) => s + e.totalHours, 0)),
    totalShifts:         rows.reduce((s, e) => s + e.totalShifts, 0),
    totalBonusShifts:    rows.reduce((s, e) => s + e.bonusShifts, 0),
    totalOvertimeHours:  _roundHours(rows.reduce((s, e) => s + e.overtimeHours, 0)),
    totalOvertimeShifts: rows.reduce((s, e) => s + e.overtimeShifts, 0),
    totalHolidayHours:   _roundHours(rows.reduce((s, e) => s + e.holidayHours, 0)),
    totalHolidayShifts:  rows.reduce((s, e) => s + e.holidayShifts, 0),
    totalLeaveHours:     _roundHours(rows.reduce((s, e) => s + e.leaveHours, 0)),
    totalLeaveCount:     rows.reduce((s, e) => s + e.leaveCount, 0),
    avgHoursPerEmployee: rows.length > 0
      ? _roundHours(rows.reduce((s, e) => s + e.totalHours, 0) / rows.length)
      : 0,
    maxHours: rows.length > 0
      ? _roundHours(Math.max(...rows.map(e => e.totalHours)))
      : 0,
    totalEmployees: rows.filter(e => e.totalHours > 0).length,
  };

  // Build email lookup for use in daily rows
  const emailMap = new Map();
  employees.forEach(e => { if (e.email) emailMap.set(String(e.id), e.email); });

  return { rows, summary, emailMap };
}

/**
 * Pre-compute a per-day breakdown from raw assignments + leaves.
 * Each entry in the returned array = one calendar day.
 * The other site can simply filter this array by date for any date-range view.
 */
function computeDailyRows(assignments, leaves, holidayMap = new Map(), emailMap = new Map()) {
  // Group assignments by date
  const byDate = {};
  assignments.forEach(a => {
    const date = a.date || (a.start_datetime ? a.start_datetime.slice(0, 10) : null);
    if (!date) return;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(a);
  });

  // Build sorted day entries
  return Object.keys(byDate).sort().map(date => {
    const dayShifts = byDate[date];
    const holiday = holidayMap.get(date);
    const shiftTypeCounts = { morning: 0, day: 0, afternoon: 0, night: 0, overtime: 0 };
    let totalHours = 0;
    let totalShifts = 0;

    const employeesOnDay = dayShifts.map(a => {
      const empId = String(a.employee_id);
      const hasAllDayLeave = leaves.some(
        l => String(l.employee_id) === empId && l.date === date && l.timeframe === 'all-day'
      );
      const leave = leaves.find(
        l => String(l.employee_id) === empId && l.date === date
      );

      const baseHours = a.shift_type === 'overtime'
        ? parseFloat(a.duration_hours || 0)
        : (SHIFT_HOURS[a.shift_type] || 8);

      // Compute leave_hours from timeframe (mirrors computeTableData logic)
      let leaveHours = 0;
      if (leave) {
        if (leave.timeframe === 'all-day') {
          leaveHours = baseHours;
        } else if (leave.timeframe === 'first-half' || leave.timeframe === 'second-half') {
          leaveHours = baseHours / 2;
        } else if (leave.timeframe === 'other' && leave.custom_start && leave.custom_end) {
          try {
            const s = new Date(`${leave.date}T${leave.custom_start}`);
            const e = new Date(`${leave.date}T${leave.custom_end}`);
            leaveHours = (e - s) / 3_600_000;
          } catch (_) { leaveHours = 0; }
        }
        leaveHours = _roundHours(Math.max(0, leaveHours));
      }

      const shiftHours = _roundHours(Math.max(0, baseHours - leaveHours));

      if (!hasAllDayLeave) {
        totalHours = _roundHours(totalHours + shiftHours);
        totalShifts += 1;
        if (shiftTypeCounts[a.shift_type] !== undefined) shiftTypeCounts[a.shift_type] += 1;
      }

      return {
        id:          a.employee_id,
        name:        a.employee_name || `Employee ${a.employee_id}`,
        email:       emailMap.get(String(a.employee_id)) || null,
        shift_type:  a.shift_type,
        shift_hours: shiftHours,
        has_leave:   !!leave,
        leave_type:  leave ? (leave.leave_type || 'unknown') : null,
        leave_hours: leaveHours,
      };
    });

    return {
      date,
      is_holiday:    !!holiday,
      holiday_name:  holiday?.name || null,
      total_shifts:  totalShifts,
      total_hours:   totalHours,
      by_shift_type: shiftTypeCounts,
      employees:     employeesOnDay,
    };
  });
}

// ─── Firestore write helper ───────────────────────────────────────────────────

async function _writeWeekDoc(weekStart, daily_rows, timestamp) {
  const ts = timestamp || new Date().toISOString();
  const res = await fetch(_firestoreUrl(weekStart), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        week_start: { stringValue: weekStart },
        daily_rows: { stringValue: JSON.stringify(daily_rows) },
        timestamp:  { stringValue: ts },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Firestore ${res.status}: ${body}`);
  }
  return res;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Push one week's data to its Firestore weekly doc (scheduleWebhooks/{weekStart}).
 * Overwrites the doc completely — no read/merge needed.
 *
 * Called when admin shows the scheduler via the "Show Scheduler" menu option.
 *
 * @param {string} weekStart   - "YYYY-MM-DD"
 * @param {Array}  assignments - shift objects for this week
 * @param {Array}  leaves      - leave objects for this week
 */
export async function pushWeekDoc(weekStart, assignments, leaves) {
  try {
    const emailMap = new Map();
    try {
      const emps = await _loadEmployees();
      emps.forEach(e => { if (e.email) emailMap.set(String(e.id), e.email); });
    } catch (_) {}

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    let holidayMap = new Map();
    try { holidayMap = await fetchHolidaysForRange(weekStart, weekEnd.toISOString().slice(0, 10)); } catch (_) {}

    const daily_rows = computeDailyRows(assignments, leaves, holidayMap, emailMap);
    await _writeWeekDoc(weekStart, daily_rows);

    console.log(`✅ pushWeekDoc: wrote ${daily_rows.length} day(s) to ${weekStart}`);
    return { success: true };
  } catch (err) {
    console.warn('webhookService: pushWeekDoc failed', err?.message || err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Scan ALL weeks in Firebase RTDB, recompute daily_rows for each, and
 * overwrite the corresponding Firestore weekly doc.
 *
 * Called from the DataTab "Push to KPI Dashboard" button.
 *
 * @returns {Promise<{success: boolean, weeks: string[], error?: string}>}
 */
export async function pushAllWeeksToFirestore() {
  try {
    const { db } = await getFirebase();
    const schedulesSnap = await get(ref(db, 'schedules'));
    if (!schedulesSnap.exists()) return { success: true, weeks: [] };

    const allWeeksData = schedulesSnap.val() || {};

    const emailMap = new Map();
    try {
      const emps = await _loadEmployees();
      emps.forEach(e => { if (e.email) emailMap.set(String(e.id), e.email); });
    } catch (_) {}

    const ts = new Date().toISOString();
    const weeks = [];

    await Promise.all(
      Object.entries(allWeeksData).map(async ([weekStart, weekData]) => {
        if (!weekData) return;

        const assignments = Array.isArray(weekData.assignments) ? weekData.assignments : [];
        const leavesRaw = weekData.leaves;
        const leaves = leavesRaw && typeof leavesRaw === 'object'
          ? Object.entries(leavesRaw).map(([id, l]) => ({ ...l, id }))
          : [];

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        let holidayMap = new Map();
        try { holidayMap = await fetchHolidaysForRange(weekStart, weekEnd.toISOString().slice(0, 10)); } catch (_) {}

        const daily_rows = computeDailyRows(assignments, leaves, holidayMap, emailMap);
        await _writeWeekDoc(weekStart, daily_rows, ts);
        weeks.push(weekStart);
      })
    );

    weeks.sort();
    console.log(`✅ pushAllWeeksToFirestore: wrote ${weeks.length} weekly doc(s)`);
    return { success: true, weeks };
  } catch (err) {
    console.warn('webhookService: pushAllWeeksToFirestore failed', err?.message || err);
    return { success: false, weeks: [], error: err?.message || String(err) };
  }
}

/**
 * Send a test document to Firestore.
 * Returns { success, status, error }.
 */
export async function testWebhook() {
  const weekStart = new Date().toISOString().slice(0, 10);
  try {
    const res = await _writeWeekDoc(weekStart, []);
    return { success: true, status: res.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
