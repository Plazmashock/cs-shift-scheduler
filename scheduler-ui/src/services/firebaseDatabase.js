/**
 * Lightweight Firebase Realtime Database helpers
 * - Lazy-initializes Firebase so the library is only downloaded when needed.
 */
import getFirebase from './lazyFirebase';
import { ref, set, push, get, child, remove, update } from 'firebase/database';
import cache, { withCache } from '../utils/cache';
import { formatDate } from '../utils/dateHelpers';

let db = null;

async function ensureDb() {
  // demo: no Firebase in demo mode — callers already handle a null db gracefully
  if (import.meta.env.VITE_DEMO_MODE === 'true') return null;
  if (db) return db;
  try {
    const { db: database } = await getFirebase();
    db = database;
    console.log('Firebase Realtime Database initialized (lazy)');
    return db;
  } catch (err) {
    console.warn('Firebase Realtime Database not initialized:', err?.message || err);
    db = null;
    return null;
  }
}

// Save or overwrite schedule for a week. If user provided, store under their uid for isolation.
export async function saveScheduleToFirebase(weekStart, scheduleData, user = null) {
  // demo: no cloud persistence — pretend success so no "cloud save failed" warning pops up
  if (import.meta.env.VITE_DEMO_MODE === 'true') return { success: true };
  const database = await ensureDb();
  if (!database) return null;
  try {
    // Use a shared schedules path so all users see the same schedules
    const path = `schedules/${weekStart}`;
    const scheduleRef = ref(database, path);

    // IMPORTANT: Leaves are stored under the same week node at `schedules/{weekStart}/leaves`.
    // Using `set()` here would overwrite the entire node and can accidentally resurrect
    // deleted leaves from stale `scheduleData` snapshots. Use `update()` and omit `leaves`
    // so schedule writes never clobber/restore leave records.
    const { leaves, ...scheduleWithoutLeaves } = (scheduleData || {});

    // Warn if leaves are present - they should be saved separately
    if (leaves && Object.keys(leaves).length > 0) {
      console.warn('⚠️ Leaves detected in scheduleData - these should be saved separately via saveLeaveToFirebase');
    }

    await update(scheduleRef, {
      ...scheduleWithoutLeaves,
      savedAt: new Date().toISOString(),
      savedBy: user?.email || null
    });

    // Invalidate cache for this week's schedule
    cache.invalidate(`schedule:${weekStart}`);

    return { success: true };
  } catch (err) {
    console.error('Failed to save schedule to Firebase:', err);
    return { success: false, error: err.message };
  }
}

// Load schedule for a week. Returns null if not found or error.
export async function loadScheduleFromFirebase(weekStart, user = null) {
  // demo: serve pre-solved schedule fixtures (real CP-SAT output) from local JSON
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    try {
      const res = await fetch(`/demo/schedule-${weekStart}.json`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
  const cacheKey = `schedule:${weekStart}`;

  return withCache(
    cacheKey,
    async () => {
      try {
        const database = await ensureDb();
        if (!database) return null;
        // Load from shared schedules path so everyone sees the same data
        const path = `schedules/${weekStart}`;
        const dbRef = ref(database);
        const snap = await get(child(dbRef, path));
        if (!snap.exists()) return null;
        const data = snap.val();
        // Firebase may return `assignments` as a keyed object instead of an array
        // when push() was used to add entries (e.g. auto-created shifts from leave imports).
        // Normalize both assignments and leaves to always be arrays.
        if (data && data.assignments && !Array.isArray(data.assignments)) {
          data.assignments = Object.values(data.assignments);
        }
        return data;
      } catch (err) {
        console.error('Failed to load schedule from Firebase:', err);
        return null;
      }
    },
    10 * 60 * 1000 // Cache for 10 minutes
  );
}

// Delete schedule for a week from Firebase
export async function deleteScheduleFromFirebase(weekStart, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `schedules/${weekStart}`;
    const scheduleRef = ref(database, path);
    // In Realtime Database, setting a path to null deletes it
    await set(scheduleRef, null);

    // Invalidate cache for this week's schedule
    cache.invalidate(`schedule:${weekStart}`);

    return { success: true };
  } catch (err) {
    console.error('Failed to delete schedule from Firebase:', err);
    return { success: false, error: err.message };
  }
}

// Shift swap requests helpers (basic)
export async function createShiftSwapRequest(requestData, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    // Store shift swap requests in a shared list so admins/operators can review
    const path = `shiftSwapRequests`;
    const listRef = ref(database, path);
    const newRef = push(listRef);
    await set(newRef, {
      ...requestData,
      createdAt: new Date().toISOString(),
      createdBy: user?.email || null
    });
    return { success: true, id: newRef.key };
  } catch (err) {
    console.error('Failed to create shift swap request:', err);
    return { success: false, error: err.message };
  }
}

export async function getShiftSwapRequests(user = null) {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const path = `shiftSwapRequests`;
    const dbRef = ref(database);
    const snap = await get(child(dbRef, path));
    if (!snap.exists()) return [];
    const data = snap.val();
    // convert to list
    return Object.keys(data).map(key => ({ id: key, ...data[key] }));
  } catch (err) {
    console.error('Failed to get shift swap requests:', err);
    return [];
  }
}

export async function updateShiftSwapRequestStatus(requestId, status, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `shiftSwapRequests/${requestId}`;
    const requestRef = ref(database, path);
    const updateData = {
      ...(await get(requestRef)).val(),
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || null
    };

    // If status is being set to 'approved' or 'rejected', also capture admin approval
    if (status === 'approved' || status === 'rejected') {
      updateData.adminApprovedBy = user?.email || null;
      updateData.adminApprovedAt = new Date().toISOString();
    }

    await set(requestRef, updateData);
    return { success: true };
  } catch (err) {
    console.error('Failed to update shift swap request:', err);
    return { success: false, error: err.message };
  }
}

// Employee approval for swap requests
export async function approveSwapRequestByEmployee(requestId, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `shiftSwapRequests/${requestId}`;
    const requestRef = ref(database, path);
    const requestData = (await get(requestRef)).val();

    await set(requestRef, {
      ...requestData,
      employeeApproved: true,
      employeeApprovedAt: new Date().toISOString(),
      employeeApprovedBy: user?.email || null
    });
    return { success: true };
  } catch (err) {
    console.error('Failed to approve swap request by employee:', err);
    return { success: false, error: err.message };
  }
}

// Revoke employee approval for a swap request
export async function revokeEmployeeApproval(requestId, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `shiftSwapRequests/${requestId}`;
    const requestRef = ref(database, path);
    const snap = await get(requestRef);
    const requestData = snap.exists() ? snap.val() : {};

    await set(requestRef, {
      ...requestData,
      employeeApproved: false,
      employeeApprovedAt: null,
      employeeApprovedBy: null,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || null
    });

    return { success: true };
  } catch (err) {
    console.error('Failed to revoke employee approval:', err);
    return { success: false, error: err.message };
  }
}

// Free shift claim requests
export async function createFreeShiftClaimRequest(requestData, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `freeShiftClaimRequests`;
    const listRef = ref(database, path);
    const newRef = push(listRef);
    await set(newRef, {
      ...requestData,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: user?.email || null,
      type: 'free-shift-claim'
    });
    return { success: true, id: newRef.key };
  } catch (err) {
    console.error('Failed to create free shift claim request:', err);
    return { success: false, error: err.message };
  }
}

export async function getFreeShiftClaimRequests(user = null) {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const path = `freeShiftClaimRequests`;
    const dbRef = ref(database);
    const snap = await get(child(dbRef, path));
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.keys(data).map(key => ({ id: key, ...data[key] }));
  } catch (err) {
    console.error('Failed to get free shift claim requests:', err);
    return [];
  }
}

export async function updateFreeShiftClaimRequestStatus(requestId, status, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `freeShiftClaimRequests/${requestId}`;
    const requestRef = ref(database, path);
    const requestData = (await get(requestRef)).val();

    // Update request status
    await set(requestRef, {
      ...requestData,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || null,
      adminApprovedBy: user?.email || null,
      adminApprovedAt: new Date().toISOString()
    });

    // If approved, add the shift to the schedule
    if (status === 'approved' && requestData) {
      // Get employee name from either employeeName or requesterName (fallback)
      const employeeName = requestData.employeeName || requestData.requesterName;
      const { employeeId, shiftType, date } = requestData;

      console.log('📋 Processing approved free shift request:', { employeeId, employeeName, shiftType, date, requestData });

      if (!employeeId || !employeeName || !shiftType || !date) {
        console.error('❌ Missing required fields:', { employeeId, employeeName, shiftType, date });
        return { success: false, error: 'Missing required fields in request data' };
      }

      // Get week start for the shift date (Monday of that week)
      const shiftDate = new Date(date);
      const day = shiftDate.getDay();
      const diff = (day + 6) % 7; // Days since Monday
      const weekStart = new Date(shiftDate);
      weekStart.setDate(shiftDate.getDate() - diff);
      weekStart.setHours(0, 0, 0, 0);

      const weekStartFormatted = formatDate(weekStart);
      console.log('📅 Week start:', weekStartFormatted, '(calculated from shift date:', date, ')');

      // Create shift data - regular shift format (NO CONSTRAINTS)
      const shiftData = {
        employee_id: parseInt(employeeId),
        employee_name: employeeName,
        shift_type: shiftType,
        date: date,
        is_overtime: false
      };

      console.log('✨ Created shift data:', JSON.stringify(shiftData, null, 2));

      // Add shift to schedule WITHOUT any constraint checking
      // IMPORTANT: Pass weekStartFormatted (string), not weekStart (Date object)
      const saveResult = await saveShiftToWeek(weekStartFormatted, employeeId, shiftData);
      if (!saveResult.success) {
        console.error('❌ Failed to add shift to schedule:', saveResult.error);
        return { success: false, error: 'Failed to add shift to schedule' };
      }

      // Invalidate cache for this week so fresh data is loaded
      cache.invalidate(`schedule:${weekStartFormatted}`);
      cache.invalidate(`leaves:${weekStartFormatted}`);
      console.log('🗑️ Invalidated cache for week:', weekStartFormatted);

      console.log('✅ Free shift successfully added to schedule for week:', weekStartFormatted);
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to update free shift claim request:', err);
    return { success: false, error: err.message };
  }
}

// Overtime request functions
export async function createOvertimeRequest(requestData, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `overtimeRequests`;
    const listRef = ref(database, path);
    const newRef = push(listRef);
    await set(newRef, {
      ...requestData,
      status: 'pending',
      createdAt: new Date().toISOString(),
      createdBy: user?.email || null,
      type: 'overtime'
    });
    return { success: true, id: newRef.key };
  } catch (err) {
    console.error('Failed to create overtime request:', err);
    return { success: false, error: err.message };
  }
}

export async function getOvertimeRequests(user = null) {
  const database = await ensureDb();
  if (!database) return [];
  try {
    const path = `overtimeRequests`;
    const dbRef = ref(database);
    const snap = await get(child(dbRef, path));
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.keys(data).map(key => ({ id: key, ...data[key] }));
  } catch (err) {
    console.error('Failed to get overtime requests:', err);
    return [];
  }
}

export async function updateOvertimeRequestStatus(requestId, status, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    const path = `overtimeRequests/${requestId}`;
    const requestRef = ref(database, path);
    const requestData = (await get(requestRef)).val();

    // Update request status
    await set(requestRef, {
      ...requestData,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.email || null,
      adminApprovedBy: user?.email || null,
      adminApprovedAt: new Date().toISOString()
    });

    // If approved, add the overtime shift to the schedule
    if (status === 'approved' && requestData) {
      const { employeeId, employeeName, startDate, startTime, endDate, endTime, durationHours } = requestData;

      console.log('📋 Processing approved overtime request:', { employeeId, employeeName, startDate, startTime, endDate, endTime, durationHours });

      if (!employeeId || !employeeName || !startDate || !startTime || !endTime) {
        console.error('❌ Missing required fields:', { employeeId, employeeName, startDate, startTime, endTime });
        return { success: false, error: 'Missing required fields in request data' };
      }

      // Get week start for the shift date (Monday of that week)
      const shiftDate = new Date(startDate);
      const day = shiftDate.getDay();
      const diff = (day + 6) % 7; // Days since Monday
      const weekStart = new Date(shiftDate);
      weekStart.setDate(shiftDate.getDate() - diff);
      weekStart.setHours(0, 0, 0, 0);

      const weekStartFormatted = formatDate(weekStart);
      console.log('📅 Week start:', weekStartFormatted, '(calculated from shift date:', startDate, ')');

      // Create overtime shift data with custom times
      const shiftData = {
        employee_id: parseInt(employeeId),
        employee_name: employeeName,
        shift_type: 'overtime',
        date: startDate,
        start_datetime: `${startDate}T${startTime}:00`,
        end_datetime: `${endDate}T${endTime}:00`,
        is_overtime: true,
        duration_hours: parseFloat(durationHours)
      };

      console.log('✨ Created overtime shift data:', JSON.stringify(shiftData, null, 2));

      // Add shift to schedule WITHOUT any constraint checking
      const saveResult = await saveShiftToWeek(weekStartFormatted, employeeId, shiftData);
      if (!saveResult.success) {
        console.error('❌ Failed to add overtime shift to schedule:', saveResult.error);
        return { success: false, error: 'Failed to add overtime shift to schedule' };
      }

      // Invalidate cache for this week so fresh data is loaded
      cache.invalidate(`schedule:${weekStartFormatted}`);
      cache.invalidate(`leaves:${weekStartFormatted}`);
      console.log('🗑️ Invalidated cache for week:', weekStartFormatted);

      console.log('✅ Overtime shift successfully added to schedule for week:', weekStartFormatted);
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to update overtime request:', err);
    return { success: false, error: err.message };
  }
}

// Apply the actual shift swap to schedule data
export async function applyShiftSwap(swapRequest, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };

  try {
    // Calculate the week start dates for both shifts (get Monday of the week)
    const getWeekStart = (dateStr) => {
      const date = new Date(dateStr);
      const day = date.getDay();
      const diff = (day + 6) % 7; // Days since Monday
      const monday = new Date(date);
      monday.setDate(date.getDate() - diff);
      return monday.toISOString().slice(0, 10); // YYYY-MM-DD format
    };

    const originalWeekStart = getWeekStart(swapRequest.originalShift.date);
    const targetWeekStart = getWeekStart(swapRequest.targetShift.date);

    // Get the week data for both shifts using proper schedule keys
    const originalWeekKey = `schedules/${originalWeekStart}`;
    const targetWeekKey = `schedules/${targetWeekStart}`;

    // Load both schedules (might be the same week)
    const originalWeekRef = ref(database, originalWeekKey);
    const originalWeekData = (await get(originalWeekRef)).val();

    let targetWeekData = originalWeekData;
    if (originalWeekKey !== targetWeekKey) {
      const targetWeekRef = ref(database, targetWeekKey);
      targetWeekData = (await get(targetWeekRef)).val();
    }

    if (!originalWeekData || !targetWeekData) {
      return { success: false, error: 'schedule-not-found' };
    }

    // Normalize assignments: Firebase may return arrays as keyed objects
    if (originalWeekData.assignments && !Array.isArray(originalWeekData.assignments)) {
      originalWeekData.assignments = Object.values(originalWeekData.assignments);
    }
    if (targetWeekData.assignments && !Array.isArray(targetWeekData.assignments)) {
      targetWeekData.assignments = Object.values(targetWeekData.assignments);
    }

    // Find and swap the assignments
    const originalAssignments = [...(originalWeekData.assignments || [])];
    const targetAssignments = originalWeekKey === targetWeekKey ? originalAssignments : [...(targetWeekData.assignments || [])];

    // Find the specific shifts to swap
    const originalShiftIndex = originalAssignments.findIndex(a =>
      a.date === swapRequest.originalShift.date &&
      a.shift_type === swapRequest.originalShift.shift_type &&
      a.employee_id === swapRequest.originalShift.employee_id
    );

    const targetShiftIndex = targetAssignments.findIndex(a =>
      a.date === swapRequest.targetShift.date &&
      a.shift_type === swapRequest.targetShift.shift_type &&
      a.employee_id === swapRequest.targetShift.employee_id
    );

    if (originalShiftIndex === -1 || targetShiftIndex === -1) {
      return { success: false, error: 'shift-not-found' };
    }

    // Perform the swap
    const originalShift = originalAssignments[originalShiftIndex];
    const targetShift = targetAssignments[targetShiftIndex];

    // Swap employee assignments
    originalAssignments[originalShiftIndex] = {
      ...originalShift,
      employee_id: targetShift.employee_id,
      employee_name: targetShift.employee_name
    };

    targetAssignments[targetShiftIndex] = {
      ...targetShift,
      employee_id: originalShift.employee_id,
      employee_name: originalShift.employee_name
    };

    // Prepare updated schedule data
    const updatedOriginalWeekData = {
      ...originalWeekData,
      assignments: originalAssignments,
      lastSwapApplied: {
        requestId: swapRequest.id,
        appliedAt: new Date().toISOString(),
        appliedBy: user?.email || null
      }
    };

    // Save the updated schedules to Firebase
    await set(originalWeekRef, updatedOriginalWeekData);

    // (No localStorage writes) Save updated original week to Firebase
    if (originalWeekKey !== targetWeekKey) {
      const targetWeekRef = ref(database, targetWeekKey);
      const updatedTargetWeekData = {
        ...targetWeekData,
        assignments: targetAssignments,
        lastSwapApplied: {
          requestId: swapRequest.id,
          appliedAt: new Date().toISOString(),
          appliedBy: user?.email || null
        }
      };

      await set(targetWeekRef, updatedTargetWeekData);
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to apply shift swap:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Save leave data for a shift
 * @param {string} weekStart - Week start date (YYYY-MM-DD format)
 * @param {Object} leaveData - Leave information
 * @returns {Promise<Object>} - Success status
 */
export async function saveLeaveToFirebase(weekStart, leaveData, user = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'Database not initialized' };

  try {
    // Store leaves under schedules/{weekStart}/leaves/{leaveId}
    const leavesPath = `schedules/${weekStart}/leaves`;
    const leavesRef = ref(database, leavesPath);

    // Generate a new leave ID
    const newLeaveRef = push(leavesRef);

    // Add metadata
    const leaveRecord = {
      ...leaveData,
      id: newLeaveRef.key,
      createdAt: new Date().toISOString(),
      createdBy: user?.email || null
    };

    await set(newLeaveRef, leaveRecord);

    // Invalidate cache for this week's leaves
    cache.invalidate(`leaves:${weekStart}`);

    return { success: true, leaveId: newLeaveRef.key };
  } catch (err) {
    console.error('Failed to save leave to Firebase:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Load all leaves for a week
 * @param {string} weekStart - Week start date (YYYY-MM-DD format)
 * @returns {Promise<Array>} - Array of leave records
 */
export async function loadLeavesFromFirebase(weekStart) {
  const cacheKey = `leaves:${weekStart}`;

  return withCache(
    cacheKey,
    async () => {
      try {
        const database = await ensureDb();
        if (!database) return [];

        const leavesPath = `schedules/${weekStart}/leaves`;
        const leavesRef = ref(database, leavesPath);
        const snapshot = await get(leavesRef);

        if (!snapshot.exists()) {
          return [];
        }

        const leavesData = snapshot.val();
        // Convert object to array and ensure each record has a stable `id`
        // (some historical/imported records may not include an `id` field).
        return Object.entries(leavesData).map(([id, leave]) => ({
          ...(leave || {}),
          id
        }));
      } catch (err) {
        console.error('Failed to load leaves from Firebase:', err);
        return [];
      }
    },
    10 * 60 * 1000 // Cache for 10 minutes
  );
}

/**
 * Delete all leave records that are associated with a specific shift.
 * This does a direct Firebase scan so it works even if the caller doesn't have
 * the leave IDs in memory.
 */
export async function deleteLeavesForShift(weekStart, shift) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'Database not initialized' };

  try {
    const shiftDateStr = shift?.date || (shift?.start_datetime ? shift.start_datetime.slice(0, 10) : null);
    const shiftEmployeeId = shift?.employee_id;
    const shiftType = shift?.shift_type;

    if (!shiftDateStr || shiftEmployeeId == null || !shiftType) {
      return { success: false, error: 'invalid-shift-identifiers' };
    }

    const normEmp = (v) => String(v);
    const normStr = (v) => String(v || '').toLowerCase().trim();

    const leavesPath = `schedules/${weekStart}/leaves`;
    const leavesRef = ref(database, leavesPath);
    const snapshot = await get(leavesRef);

    if (!snapshot.exists()) {
      return { success: true, deleted: 0 };
    }

    const leavesData = snapshot.val() || {};
    const toDelete = Object.entries(leavesData).filter(([, leave]) => {
      if (!leave) return false;
      // Prefer shift_id match (precise); fall back to tuple for legacy data
      if (shift?.shift_id && leave.shift_id) {
        return leave.shift_id === shift.shift_id;
      }
      return (
        normEmp(leave.employee_id) === normEmp(shiftEmployeeId) &&
        String(leave.date) === String(shiftDateStr) &&
        normStr(leave.shift_type) === normStr(shiftType)
      );
    });

    await Promise.all(
      toDelete.map(([leaveId]) => remove(ref(database, `${leavesPath}/${leaveId}`)))
    );

    cache.invalidate(`leaves:${weekStart}`);

    return { success: true, deleted: toDelete.length };
  } catch (err) {
    console.error('Failed to delete leaves for shift:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a leave record from Firebase
 * @param {string} weekStart - Week start date (YYYY-MM-DD format)
 * @param {string} leaveId - Leave record ID to delete
 * @returns {Promise<Object>} - Success status
 */
export async function deleteLeaveFromFirebase(weekStart, leaveId) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'Database not initialized' };

  try {
    const leavePath = `schedules/${weekStart}/leaves/${leaveId}`;
    const leaveRef = ref(database, leavePath);
    await remove(leaveRef);

    // Invalidate cache for this week's leaves
    cache.invalidate(`leaves:${weekStart}`);

    return { success: true };
  } catch (err) {
    console.error('Failed to delete leave from Firebase:', err);
    return { success: false, error: err.message };
  }
}

// Get scheduler visibility status for a specific week
export async function getWeekSchedulerVisibility(weekStart) {
  const database = await ensureDb();
  if (!database) return false;
  try {
    const statusRef = ref(database, `admin/hidden_weeks/${weekStart}`);
    const snapshot = await get(statusRef);
    return snapshot.exists() ? snapshot.val() : false;
  } catch (err) {
    console.error('Failed to load week scheduler visibility:', err);
    return false;
  }
}

// Set scheduler visibility status for a specific week
export async function setWeekSchedulerVisibility(weekStart, isHidden) {
  const database = await ensureDb();
  if (!database) return null;
  try {
    if (isHidden) {
      const statusRef = ref(database, `admin/hidden_weeks/${weekStart}`);
      await set(statusRef, true);
      console.log(`Week ${weekStart} hidden from employees`);
    } else {
      const statusRef = ref(database, `admin/hidden_weeks/${weekStart}`);
      await remove(statusRef);
      console.log(`Week ${weekStart} is now visible to employees`);
    }
    return { success: true };
  } catch (err) {
    console.error('Failed to set week scheduler visibility:', err);
    return { success: false, error: err.message };
  }
}

export async function getAdminNotes() {
  const database = await ensureDb();
  if (!database) return '';
  try {
    const notesRef = ref(database, 'admin/schedule_generation_notes');
    const snapshot = await get(notesRef);
    return snapshot.val() || '';
  } catch (err) {
    console.error('Failed to get admin notes:', err);
    return '';
  }
}

export async function setAdminNotes(notes) {
  const database = await ensureDb();
  if (!database) return null;
  try {
    const notesRef = ref(database, 'admin/schedule_generation_notes');
    await set(notesRef, notes);
    console.log('Admin notes saved successfully');
    return { success: true };
  } catch (err) {
    console.error('Failed to set admin notes:', err);
    return { success: false, error: err.message };
  }
}

// Delete a single shift from a week's schedule
// Note: shiftId is not used - we identify shifts by employee_id, date, and shift_type
export async function deleteShift(weekStart, employeeId, shiftId, assignmentData = null) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    // Load current schedule for the week
    const scheduleData = await loadScheduleFromFirebase(weekStart);
    if (!scheduleData || !scheduleData.assignments) {
      return { success: false, error: 'schedule-not-found' };
    }

    // Find and remove the shift from assignments array
    // Match by employee_id, date, and shift_type
    const initialLength = scheduleData.assignments.length;

    if (assignmentData) {
      // Use provided assignment data for precise matching
      scheduleData.assignments = scheduleData.assignments.filter(a =>
        !(a.employee_id === assignmentData.employee_id &&
          a.date === assignmentData.date &&
          a.shift_type === assignmentData.shift_type)
      );
    } else {
      // Fallback: just remove first match for this employee (less reliable)
      scheduleData.assignments = scheduleData.assignments.filter((a, idx) =>
        !(idx === 0 && a.employee_id === employeeId)
      );
    }

    const finalLength = scheduleData.assignments.length;

    if (finalLength === initialLength) {
      console.warn('No shift found to delete for:', { employeeId, shiftId, assignmentData });
      return { success: false, error: 'shift-not-found' };
    }

    // Update total_assignments count
    scheduleData.total_assignments = scheduleData.assignments.length;

    // Save updated schedule back to Firebase
    await saveScheduleToFirebase(weekStart, scheduleData);

    console.log(`✅ Deleted shift successfully. Before: ${initialLength}, After: ${finalLength} assignments`);
    return { success: true };
  } catch (err) {
    console.error('Failed to delete shift:', err);
    return { success: false, error: err.message };
  }
}

// Save a single shift to a week's schedule (for undo operations)
export async function saveShiftToWeek(weekStart, employeeId, shiftData) {
  const database = await ensureDb();
  if (!database) return { success: false, error: 'db-unavailable' };
  try {
    console.log('💾 saveShiftToWeek called with:', { weekStart, employeeId, shiftData });

    // Load current schedule for the week
    let scheduleData = await loadScheduleFromFirebase(weekStart);
    if (!scheduleData) {
      scheduleData = { assignments: [], status: 'manual' };
      console.log('📝 Created new schedule data for week');
    } else {
      console.log('📋 Loaded existing schedule with', scheduleData.assignments?.length || 0, 'assignments');
    }

    if (!scheduleData.assignments) {
      scheduleData.assignments = [];
    }

    console.log('➕ Adding shift to assignments array...');
    // Add the shift to assignments array - NO CONSTRAINT CHECKING
    scheduleData.assignments.push(shiftData);

    // Update total_assignments count
    scheduleData.total_assignments = scheduleData.assignments.length;

    console.log('💿 Saving schedule with', scheduleData.total_assignments, 'total assignments');
    // Save updated schedule back to Firebase
    await saveScheduleToFirebase(weekStart, scheduleData);

    console.log('✅ Shift saved successfully to Firebase');
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to save shift:', err);
    return { success: false, error: err.message };
  }
}

export default {
  saveScheduleToFirebase,
  loadScheduleFromFirebase,
  createShiftSwapRequest,
  getShiftSwapRequests,
  updateShiftSwapRequestStatus,
  createFreeShiftClaimRequest,
  getFreeShiftClaimRequests,
  updateFreeShiftClaimRequestStatus,
  createOvertimeRequest,
  getOvertimeRequests,
  updateOvertimeRequestStatus,
  approveSwapRequestByEmployee,
  applyShiftSwap,
  saveLeaveToFirebase,
  loadLeavesFromFirebase,
  deleteLeavesForShift,
  deleteLeaveFromFirebase,
  getWeekSchedulerVisibility,
  setWeekSchedulerVisibility,
  deleteShift,
  saveShiftToWeek
};
