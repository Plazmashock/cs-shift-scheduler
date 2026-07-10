/**
 * Catchup Webhook Service
 * Pushes catchup meeting data to Firestore in the your-kpi-project-id project
 * for display in the KPI dashboard management UI.
 * 
 * Destination: projects/your-kpi-project-id/databases/(default)/documents/catchupMeetings/{employeeId}
 */

import getFirebase from './lazyFirebase';
import { ref, get } from 'firebase/database';

const FIREBASE_PROJECT = 'your-kpi-project-id';
const API_KEY = 'YOUR_FIREBASE_API_KEY';

function _firestoreUrl(employeeId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/catchupMeetings/${employeeId}?key=${API_KEY}`;
}

function _settingsUrl() {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/catchupSettings/config?key=${API_KEY}`;
}

/**
 * Convert JavaScript value to Firestore field format
 */
function _toFirestoreField(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    return { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (Array.isArray(value)) {
    return { stringValue: JSON.stringify(value) };
  }
  if (typeof value === 'object') {
    return { stringValue: JSON.stringify(value) };
  }
  return { stringValue: String(value) };
}

/**
 * Calculate days overdue/until due
 */
function _calculateDaysOverdue(nextDue) {
  if (!nextDue) return 0;
  const now = new Date();
  const dueDate = new Date(nextDue);
  const diffMs = now - dueDate;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determine status based on nextDue date
 */
function _getStatus(nextDue, hasScheduledMeeting) {
  if (!nextDue) return 'never';
  if (hasScheduledMeeting) return 'scheduled';
  
  const daysOverdue = _calculateDaysOverdue(nextDue);
  if (daysOverdue > 0) return 'overdue';
  if (daysOverdue >= -7) return 'due-soon';
  return 'ok';
}

/**
 * Push single employee's catchup data to Firestore
 */
export async function pushCatchupData(employeeId, catchupData, employeeInfo = null) {
  try {
    // Calculate derived fields
    const daysOverdue = _calculateDaysOverdue(catchupData.nextDue);
    const hasScheduledMeeting = catchupData.history?.some(h => h.status === 'scheduled') || false;
    const status = _getStatus(catchupData.nextDue, hasScheduledMeeting);
    
    // Build Firestore document
    const firestoreDoc = {
      fields: {
        employeeId: _toFirestoreField(String(employeeId)),
        employeeName: _toFirestoreField(employeeInfo?.name || catchupData.employeeName || ''),
        employeeEmail: _toFirestoreField(employeeInfo?.email || catchupData.employeeEmail || ''),
        managerId: _toFirestoreField(catchupData.managerId || ''),
        managerName: _toFirestoreField(catchupData.managerName || ''),
        
        lastMeeting: _toFirestoreField(catchupData.lastMeeting || null),
        nextDue: _toFirestoreField(catchupData.nextDue || null),
        daysOverdue: _toFirestoreField(daysOverdue),
        status: _toFirestoreField(status),
        
        frequencyDays: _toFirestoreField(catchupData.frequencyDays || 14),
        history: _toFirestoreField(catchupData.history || []),
        
        lastUpdated: _toFirestoreField(new Date().toISOString())
      }
    };
    
    const response = await fetch(_firestoreUrl(employeeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firestoreDoc)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore ${response.status}: ${errorText}`);
    }
    
    console.log(`✅ Pushed catchup data for employee ${employeeId} to KPI dashboard`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Failed to push catchup data for employee ${employeeId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Push all catchup data to Firestore (bulk sync)
 */
export async function pushAllCatchupData() {
  try {
    const firebase = await getFirebase();
    
    // Load all catchup meetings from Firebase RTDB
    const catchupSnapshot = await get(ref(firebase.db, 'admin/catchup_meetings'));
    const catchupData = catchupSnapshot.val();
    
    if (!catchupData) {
      console.log('ℹ️ No catchup data to push');
      return { success: true, count: 0 };
    }
    
    // Load employee info for enrichment
    const employeesSnapshot = await get(ref(firebase.db, 'teamMembers'));
    const employeesData = employeesSnapshot.val() || {};
    const employeeMap = {};
    Object.values(employeesData).forEach(emp => {
      if (emp && emp.id) {
        employeeMap[String(emp.id)] = emp;
      }
    });
    
    // Push each employee's catchup data
    const results = [];
    for (const [employeeId, data] of Object.entries(catchupData)) {
      const employeeInfo = employeeMap[String(employeeId)];
      const result = await pushCatchupData(employeeId, data, employeeInfo);
      results.push({ employeeId, ...result });
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Pushed ${successCount} catchup records to KPI dashboard (${failCount} failed)`);
    
    return {
      success: true,
      count: successCount,
      failed: failCount,
      results
    };
    
  } catch (error) {
    console.error('❌ Failed to push all catchup data:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Push catchup settings to Firestore
 */
export async function pushCatchupSettings(settings) {
  try {
    const firestoreDoc = {
      fields: {
        frequencyDays: _toFirestoreField(settings.frequency_days || 14),
        leadTimeDays: _toFirestoreField(settings.lead_time_days || 7),
        defaultDurationMinutes: _toFirestoreField(settings.default_duration_minutes || 60),
        roomEmails: _toFirestoreField(settings.room_emails || []),
        lastUpdated: _toFirestoreField(new Date().toISOString())
      }
    };
    
    const response = await fetch(_settingsUrl(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(firestoreDoc)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Firestore ${response.status}: ${errorText}`);
    }
    
    console.log('✅ Pushed catchup settings to KPI dashboard');
    return { success: true };
    
  } catch (error) {
    console.error('❌ Failed to push catchup settings:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Test the catchup webhook (for debugging)
 */
export async function testCatchupWebhook() {
  const testData = {
    employeeId: 'test-123',
    employeeName: 'Test Employee',
    employeeEmail: 'test@example.com',
    managerId: 'manager@example.com',
    managerName: 'Test Manager',
    lastMeeting: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    nextDue: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
    frequencyDays: 14,
    history: [
      {
        date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        startTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000 + 3600000).toISOString(),
        meetingId: 'test_calendar_event_123',
        roomId: 'room1@resource.calendar.example.com',
        roomName: 'Meeting Room 1',
        status: 'completed',
        notes: 'Test meeting',
        createdAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  };
  
  return await pushCatchupData('test-123', testData, {
    name: 'Test Employee',
    email: 'test@example.com'
  });
}
