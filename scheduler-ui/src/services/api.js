/**
 * API service for communicating with the CS Scheduler backend
 * Handles schedule generation, exports, and error management
 */

// Prefer relative path so the Vite dev server proxy (configured in vite.config.js) handles CORS.
// Allow override via window.__API_BASE_URL__ (can be injected in index.html) or environment var replacement at build time.
// If someone accidentally configured a us-central1 Cloud Run URL, auto-map it to the europe-west1 service we run.
const _windowOverride = (typeof window !== 'undefined' && window.__API_BASE_URL__) || null;
let _envUrl = import.meta?.env?.VITE_API_BASE_URL || null;

if (
  _envUrl &&
  _envUrl.includes('us-central1.run.app') &&
  _envUrl.includes('cs-scheduler')
) {
  const mapped = _envUrl.replace('us-central1.run.app', 'europe-west1.run.app');
  // eslint-disable-next-line no-console
  console.warn(`VITE_API_BASE_URL pointed to us-central1; remapping to europe-west1: ${mapped}`);
  _envUrl = mapped;
}

// Final default: the verified Cloud Run service in europe-west1. This prevents accidental calls
// to older us-central1 endpoints that don't have the correct CORS config.
const API_BASE_URL =
  _windowOverride ||
  _envUrl ||
  'https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app';

// If running in browser on localhost, prefer relative '/api' so Vite proxy forwards to local backend
try {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      // Use relative path; callers build URLs like `${API_BASE_URL}/api/...` so set to empty string
      // and let fetch('/api/...') resolve to current origin which Vite proxies to localhost:8000
      // For safety, set window.__API_BASE_URL__ too.
      window.__API_BASE_URL__ = '';
    }
  }
} catch (e) {
  // ignore
}

// eslint-disable-next-line no-console
console.debug('Using API_BASE_URL:', API_BASE_URL);

/**
 * Get authentication headers with Firebase ID token
 * @param {Function} getIdToken - Function to get current user's ID token
 * @returns {Promise<Object>} Headers object with authorization
 */
async function getAuthHeaders(getIdToken) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (getIdToken) {
    try {
      const token = await getIdToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Failed to get auth token:', error);
    }
  }
  
  return headers;
}

// demo: the static demo has no backend. "Generate" serves pre-computed rosters
// produced by the real OR-Tools CP-SAT solver (see public/demo/), cycling
// v1 -> v2 -> v3 -> v1 on each click so the result visibly changes.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
const DEMO_VARIANT_SUFFIXES = ['', '-v2', '-v3'];
let demoVariantIdx = 0;

// demo: throw a clean, user-facing error for backend-only actions
function demoDisabled(action) {
  throw new Error(`${action} is disabled in this demo — the live backend is not deployed.`);
}

// demo: serve the next pre-solved fixture after a short "solving" pause
async function generateScheduleDemo(spec) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  demoVariantIdx = (demoVariantIdx + 1) % DEMO_VARIANT_SUFFIXES.length;
  const suffix = DEMO_VARIANT_SUFFIXES[demoVariantIdx];
  const res = await fetch(`/demo/schedule-${spec.week_start}${suffix}.json`);
  if (!res.ok) {
    throw new Error('This demo only includes pre-computed schedules for the week of Jul 6, 2026. Pick that week and try again.');
  }
  const data = await res.json();
  return { ...data, demo: true, demo_variant: demoVariantIdx };
}

/**
 * Generate a new schedule from the backend
 * @param {Object} spec - Schedule specification
 * @param {string} spec.week_start - Week start date (YYYY-MM-DD)
 * @param {Array} spec.employees - Array of employee objects {id, name}
 * @param {Object} spec.options - Scheduling options
 * @param {Function} getIdToken - Function to get Firebase ID token
 * @returns {Promise<Object>} Schedule response with assignments and summary
 */
export async function generateSchedule(spec, getIdToken) {
  if (DEMO_MODE) return generateScheduleDemo(spec); // demo: pre-computed real solver output
  try {
    const headers = await getAuthHeaders(getIdToken);
    const response = await fetch(`${API_BASE_URL}/api/generate-schedule`, {
      method: 'POST',
      headers,
      body: JSON.stringify(spec),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      const errorMessage = errorData.error || errorData.message || `HTTP ${response.status}: ${response.statusText}`;
      const errorDetails = errorData.details ? ` - ${errorData.details}` : '';
      throw new Error(`${errorMessage}${errorDetails}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const enhancedMessage = !isOnline
      ? 'Network offline – please check your internet connection.'
      : error.message.includes('Failed to fetch')
        ? 'Cannot reach the backend server. Please try again in a moment.'
        : error.message;
    console.error('Failed to generate schedule:', error);
    throw new Error(`Failed to generate schedule: ${enhancedMessage}`);
  }
}

/**
 * Test API connectivity
 * @returns {Promise<Object>} Health check response
 */
export async function testApiConnection() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API connectivity test failed:', error);
    throw error;
  }
}

/**
 * Export schedule as CSV
 * @param {Object} scheduleData - Schedule assignments
 * @param {Function} getIdToken - Function to get Firebase ID token
 * @returns {Promise<Blob>} CSV file blob
 */
export async function exportScheduleCSV(scheduleData, getIdToken) {
  if (DEMO_MODE) demoDisabled('CSV export'); // demo: needs the backend
  try {
    const headers = await getAuthHeaders(getIdToken);
    const response = await fetch(`${API_BASE_URL}/api/export-csv`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ assignments: scheduleData.assignments }),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Failed to export CSV:', error);
    throw new Error(`CSV export failed: ${error.message}`);
  }
}

/**
 * Export worked hours and total shifts to Google Sheets.
 * @param {Object} params
 * @param {string} params.start_date - Start date YYYY-MM-DD (optional, defaults to last completed week)
 * @param {string} params.end_date   - End date   YYYY-MM-DD (optional)
 * @param {Function} getIdToken - Function to get Firebase ID token
 * @returns {Promise<Object>} Result with rows_updated, columns used, etc.
 */
export async function exportToSheets({ start_date, end_date } = {}, getIdToken) {
  if (DEMO_MODE) demoDisabled('Google Sheets export'); // demo: needs the backend
  try {
    const headers = await getAuthHeaders(getIdToken);
    const body = {};
    if (start_date) body.start_date = start_date;
    if (end_date) body.end_date = end_date;
    const response = await fetch(`${API_BASE_URL}/api/export-to-sheets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Export to Sheets failed: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to export to Google Sheets:', error);
    throw error;
  }
}

/**
 * Send a Slack DM to notify an employee of a swap request
 * @param {Object} data
 * @param {string} data.target_email - Target employee's email
 * @param {string} data.requester_name - Name of the employee requesting the swap
 * @param {Object} data.original_shift - {date, type, time} of requester's shift
 * @param {Object} data.target_shift - {date, type, time} of target's shift
 * @param {Function} getIdToken - Function to get Firebase ID token
 */
export async function notifySlack(data, getIdToken) {
  if (DEMO_MODE) demoDisabled('Slack notification'); // demo: needs the backend
  try {
    const headers = await getAuthHeaders(getIdToken);
    const response = await fetch(`${API_BASE_URL}/api/notify-slack`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send Slack notification:', error);
    throw error;
  }
}

/**
 * Send daily shift schedule to admins via Slack
 * @param {Object} params
 * @param {boolean} params.test_mode - If true, returns message preview
 * @param {string} params.date - Target date (YYYY-MM-DD), optional
 * @param {Function} getIdToken - Function to get Firebase ID token
 * @returns {Promise<Object>} Result with sent_to array and message_preview
 */
export async function sendDailyShiftNotification({ test_mode = false, date = null } = {}, getIdToken) {
  if (DEMO_MODE) demoDisabled('Slack notification'); // demo: needs the backend
  try {
    const headers = await getAuthHeaders(getIdToken);
    const response = await fetch(`${API_BASE_URL}/api/send-daily-shifts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ test_mode, date }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to send daily shift notification:', error);
    throw error;
  }
}

export async function notifyScheduleReady(weekLabel, getIdToken) {
  if (DEMO_MODE) demoDisabled('Employee notification'); // demo: needs the backend
  const headers = await getAuthHeaders(getIdToken);
  const response = await fetch(`${API_BASE_URL}/api/notify-schedule-ready`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ week_label: weekLabel }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * Export schedule as JSON
 * @param {Object} scheduleData - Schedule assignments  
 * @returns {Promise<Blob>} JSON file blob
 */
export async function exportScheduleJSON(scheduleData, getIdToken) {
  if (DEMO_MODE) demoDisabled('JSON export'); // demo: needs the backend
  try {
    const headers = await getAuthHeaders(getIdToken);
    const response = await fetch(`${API_BASE_URL}/api/export-json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ assignments: scheduleData.assignments }),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error) {
    console.error('Failed to export JSON:', error);
    throw new Error(`JSON export failed: ${error.message}`);
  }
}

/**
 * Download a blob as a file
 * @param {Blob} blob - File blob
 * @param {string} filename - Download filename
 */
export function downloadFile(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Mock data for offline development
 * Remove this when backend is ready
 */
export function getMockScheduleData() {
  const employees = [
    { id: 1, name: 'Nia Kavtaradze' },
    { id: 2, name: 'Tamuna Janelidze' },
    { id: 3, name: 'Nino Beridze' },
    { id: 4, name: 'Eka Tsiklauri' },
    { id: 5, name: 'Mari Kutaladze' },
  ];

  const assignments = [
    {
      employee_id: 1,
      employee_name: 'Nia Kavtaradze',
      date: '2025-10-06',
      shift_type: 'morning',
      start_datetime: '2025-10-06T04:00:00+00:00',
      end_datetime: '2025-10-06T13:00:00+00:00',
    },
    {
      employee_id: 2,
      employee_name: 'Tamuna Janelidze', 
      date: '2025-10-06',
      shift_type: 'day',
      start_datetime: '2025-10-06T10:00:00+00:00',
      end_datetime: '2025-10-06T19:00:00+00:00',
    },
    {
      employee_id: 3,
      employee_name: 'Nino Beridze',
      date: '2025-10-06',
      shift_type: 'afternoon',
      start_datetime: '2025-10-06T15:00:00+00:00',
      end_datetime: '2025-10-07T00:00:00+00:00',
    },
    {
      employee_id: 4,
      employee_name: 'Eka Tsiklauri',
      date: '2025-10-06',
      shift_type: 'night',
      start_datetime: '2025-10-06T19:00:00+00:00', 
      end_datetime: '2025-10-07T04:00:00+00:00',
    },
    {
      employee_id: 1,
      employee_name: 'Nia Kavtaradze',
      date: '2025-10-07',
      shift_type: 'day',
      start_datetime: '2025-10-07T10:00:00+00:00',
      end_datetime: '2025-10-07T19:00:00+00:00',
    },
  ];

  return {
    status: 'mock',
    assignments,
    summary: {
      '2025-10-06': { morning: 1, day: 1, afternoon: 1, night: 1 },
      '2025-10-07': { morning: 0, day: 1, afternoon: 0, night: 0 },
    },
  };
}