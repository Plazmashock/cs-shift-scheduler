/**
 * Google Calendar API Integration
 * Handles OAuth authentication and calendar event creation for shift schedules
 */

const CALENDAR_API_KEY = 'YOUR_GOOGLE_CALENDAR_API_KEY';
const CLIENT_ID = 'YOUR_OAUTH_CLIENT_ID.apps.googleusercontent.com';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let gapiInited = false;
let gisInited = false;
let tokenClient = null;

/**
 * Initialize Google API client
 */
async function initializeGapiClient() {
  if (gapiInited) return;

  await new Promise((resolve) => {
    gapi.load('client', resolve);
  });

  await gapi.client.init({
    apiKey: CALENDAR_API_KEY,
    discoveryDocs: [DISCOVERY_DOC],
  });

  gapiInited = true;
  console.log('Google API client initialized');
}

/**
 * Initialize Google Identity Services
 */
function initializeGisClient(callback) {
  if (gisInited) {
    callback();
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: '', // Will be set by request function
  });

  gisInited = true;
  console.log('Google Identity Services initialized');
  callback();
}

/**
 * Load the Google API and Identity scripts
 */
export async function loadGoogleScripts() {
  return new Promise((resolve, reject) => {
    // Load GAPI script
    if (!window.gapi) {
      const gapiScript = document.createElement('script');
      gapiScript.src = 'https://apis.google.com/js/api.js';
      gapiScript.async = true;
      gapiScript.defer = true;
      gapiScript.onload = () => {
        // Load GIS script
        if (!window.google?.accounts) {
          const gisScript = document.createElement('script');
          gisScript.src = 'https://accounts.google.com/gsi/client';
          gisScript.async = true;
          gisScript.defer = true;
          gisScript.onload = () => {
            initializeGapiClient().then(() => {
              initializeGisClient(() => resolve());
            }).catch(reject);
          };
          gisScript.onerror = () => reject(new Error('Failed to load Google Identity Services'));
          document.head.appendChild(gisScript);
        } else {
          initializeGapiClient().then(() => {
            initializeGisClient(() => resolve());
          }).catch(reject);
        }
      };
      gapiScript.onerror = () => reject(new Error('Failed to load Google API'));
      document.head.appendChild(gapiScript);
    } else {
      initializeGapiClient().then(() => {
        initializeGisClient(() => resolve());
      }).catch(reject);
    }
  });
}

/**
 * Request access token and authenticate user
 */
export function requestAccessToken() {
  return new Promise((resolve, reject) => {
    try {
      if (!tokenClient) {
        reject(new Error('Google Identity Services not initialized. Token client is null.'));
        return;
      }

      tokenClient.callback = async (response) => {
        if (response.error) {
          console.error('OAuth error:', response);
          reject(new Error(`OAuth failed: ${response.error}`));
          return;
        }
        resolve(response);
      };

      // Prompt user for consent if needed
      if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    } catch (error) {
      console.error('Error requesting access token:', error);
      reject(error);
    }
  });
}

/**
 * Convert shift data to Google Calendar event format
 * @param {Object} assignment - Shift assignment object
 * @param {string} employeeName - Employee name
 * @param {string} timezone - Timezone (default: 'Asia/Tbilisi' for Georgia)
 * @returns {Object} Google Calendar event object
 */
function createEventFromShift(assignment, employeeName, timezone = 'Asia/Tbilisi') {
  // Validate datetime fields
  if (!assignment.start_datetime || !assignment.end_datetime) {
    console.error('Invalid assignment - missing datetime fields:', assignment);
    throw new Error('Assignment must have start_datetime and end_datetime fields');
  }

  // Parse start and end times - ensure they are valid ISO strings
  let startDateTime, endDateTime;
  
  try {
    // The backend stores times as UTC, but they represent local Tbilisi times
    // We need to reinterpret the UTC times as local times
    // For example: "2025-10-14T10:00:00.000Z" should be "10:00 Tbilisi time" not "10:00 UTC"
    
    const startUTC = typeof assignment.start_datetime === 'string' 
      ? new Date(assignment.start_datetime) 
      : assignment.start_datetime;
    
    const endUTC = typeof assignment.end_datetime === 'string'
      ? new Date(assignment.end_datetime)
      : assignment.end_datetime;

    // Validate parsed dates
    if (isNaN(startUTC.getTime()) || isNaN(endUTC.getTime())) {
      throw new Error('Invalid date format');
    }

    // Extract the date and time components from UTC, but treat them as local Tbilisi time
    // This creates a new datetime string in the format Google Calendar expects for the timezone
    const formatAsLocalTime = (utcDate) => {
      const year = utcDate.getUTCFullYear();
      const month = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(utcDate.getUTCDate()).padStart(2, '0');
      const hours = String(utcDate.getUTCHours()).padStart(2, '0');
      const minutes = String(utcDate.getUTCMinutes()).padStart(2, '0');
      const seconds = String(utcDate.getUTCSeconds()).padStart(2, '0');
      
      // Return RFC3339 format without timezone (will use the timeZone field)
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    };

    const startLocal = formatAsLocalTime(startUTC);
    const endLocal = formatAsLocalTime(endUTC);

    // Parse them back to Date objects for midnight crossing check
    startDateTime = new Date(startUTC);
    endDateTime = new Date(endUTC);

    // Fix for shifts that cross midnight (afternoon 15:00-00:00, night 19:00-04:00)
    // If end time appears to be before or equal to start time, it means the shift crosses midnight
    if (endDateTime <= startDateTime) {
      console.log('Detected shift crossing midnight, adding 1 day to end time:', {
        shift_type: assignment.shift_type,
        original_end: endLocal,
      });
      
      // Add 24 hours to end time
      endDateTime = new Date(endDateTime.getTime() + 24 * 60 * 60 * 1000);
    }

    // Reformat with corrected end time
    const endLocalCorrected = formatAsLocalTime(endDateTime);
    
    // Shift type emojis
    const shiftEmojis = {
      morning: '🌅',
      day: '☀️',
      afternoon: '🌇',
      night: '🌙',
      overtime: '⚡'
    };

    const emoji = shiftEmojis[assignment.shift_type] || '📅';
    const shiftLabel = assignment.shift_type.charAt(0).toUpperCase() + assignment.shift_type.slice(1);

    // Format for Google Calendar - use RFC3339 format without Z (let timezone field handle it)
    const event = {
      summary: `${emoji} ${shiftLabel} Shift - ${employeeName}`,
      description: `CS Support Shift\nEmployee: ${employeeName}\nShift Type: ${shiftLabel}`,
      start: {
        dateTime: startLocal,
        timeZone: timezone,
      },
      end: {
        dateTime: endLocalCorrected,
        timeZone: timezone,
      },
      colorId: getColorIdForShiftType(assignment.shift_type),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 }, // 1 hour before
          { method: 'popup', minutes: 15 }, // 15 minutes before
        ],
      },
    };

    console.log('Created calendar event:', {
      summary: event.summary,
      start: event.start.dateTime,
      end: event.end.dateTime,
      timezone: event.start.timeZone,
      originalUTC: {
        start: assignment.start_datetime,
        end: assignment.end_datetime
      }
    });

    return event;
  } catch (error) {
    console.error('Error parsing shift datetimes:', {
      assignment,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get Google Calendar color ID for shift type
 */
function getColorIdForShiftType(shiftType) {
  const colorMap = {
    morning: '6', // Orange
    day: '5',     // Yellow
    afternoon: '3', // Purple
    night: '9',   // Blue
    overtime: '11', // Red
  };
  return colorMap[shiftType] || '1'; // Default blue
}

/**
 * Create a single calendar event
 * @param {Object} event - Google Calendar event object
 * @returns {Promise<Object>} Created event
 */
export async function createCalendarEvent(event) {
  try {
    const response = await gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource: event,
    });
    return response.result;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

/**
 * Export all shifts for a specific employee to their Google Calendar
 * @param {Array} assignments - All shift assignments for the week
 * @param {Object} employee - Employee object with id, name, email
 * @param {string} timezone - Timezone (default: 'Asia/Tbilisi')
 * @returns {Promise<Object>} Results with success/failure counts
 */
export async function exportEmployeeShiftsToCalendar(assignments, employee, timezone = 'Asia/Tbilisi') {
  // Filter assignments for this employee
  const employeeShifts = assignments.filter(a => a.employee_id === employee.id);

  if (employeeShifts.length === 0) {
    throw new Error(`No shifts found for ${employee.name}`);
  }

  const results = {
    success: 0,
    failed: 0,
    errors: [],
    events: []
  };

  // Create events one by one (batch API is more complex and requires separate setup)
  for (const shift of employeeShifts) {
    try {
      const event = createEventFromShift(shift, employee.name, timezone);
      const created = await createCalendarEvent(event);
      results.success++;
      results.events.push(created);
      
      // Small delay to avoid rate limits (10 requests/second limit)
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      results.failed++;
      results.errors.push({
        shift,
        error: error.message
      });
      console.error(`Failed to create event for shift:`, shift, error);
    }
  }

  return results;
}

/**
 * Export shifts for a single employee (used when employee exports their own shifts)
 * @param {Array} assignments - All shift assignments
 * @param {string} userEmail - Logged-in user's email
 * @param {Array} employees - All employees
 * @param {string} timezone - Timezone
 * @returns {Promise<Object>} Export results
 */
export async function exportMyShiftsToCalendar(assignments, userEmail, employees, timezone = 'Asia/Tbilisi') {
  // Enhanced employee matching with multiple fallback strategies
  const userEmailLower = userEmail.toLowerCase().trim();
  const username = userEmailLower.split('@')[0];
  
  // Try 1: Exact email match (case-insensitive)
  let employee = employees.find(emp => 
    emp?.email && emp.email.toLowerCase().trim() === userEmailLower
  );
  
  // Try 2: Username match (before @)
  if (!employee) {
    employee = employees.find(emp => {
      if (!emp?.email) return false;
      const empEmail = emp.email.toLowerCase().trim();
      return empEmail.startsWith(username + '@') || empEmail.split('@')[0] === username;
    });
  }
  
  // Try 3: Name-based matching (e.g., luka.japaridze matches "Luka Japaridze")
  if (!employee) {
    const usernameParts = username.split(/[._-]/);
    employee = employees.find(emp => {
      if (!emp?.name) return false;
      const empNameLower = emp.name.toLowerCase();
      return usernameParts.length >= 2 && 
             usernameParts.every(part => empNameLower.includes(part));
    });
  }
  
  console.log('Employee matching result:', {
    userEmail,
    matchedEmployee: employee ? {
      id: employee.id,
      name: employee.name,
      email: employee.email
    } : null,
    totalEmployees: employees.length,
    employeesWithEmail: employees.filter(e => e?.email).length
  });
  
  if (!employee) {
    // Provide detailed error message
    const employeesList = employees
      .filter(e => e?.email)
      .map(e => `  • ${e.name} (${e.email})`)
      .join('\n');
    
    throw new Error(
      `No employee found matching email: ${userEmail}\n\n` +
      `Your email must be added to the employee list by an administrator.\n\n` +
      `Current employees with emails:\n${employeesList || '  (none)'}`
    );
  }

  // Export only this employee's shifts
  return await exportEmployeeShiftsToCalendar(assignments, employee, timezone);
}

/**
 * Export all shifts for all employees to Google Calendar
 * @param {Array} assignments - All shift assignments
 * @param {Array} employees - All employees
 * @param {string} timezone - Timezone
 * @returns {Promise<Object>} Aggregated results
 */
export async function exportAllShiftsToCalendar(assignments, employees, timezone = 'Asia/Tbilisi') {
  const aggregatedResults = {
    totalEmployees: 0,
    successfulEmployees: 0,
    totalEvents: 0,
    successfulEvents: 0,
    failedEvents: 0,
    errors: []
  };

  for (const employee of employees) {
    const employeeShifts = assignments.filter(a => a.employee_id === employee.id);
    
    if (employeeShifts.length === 0) {
      continue; // Skip employees with no shifts
    }

    aggregatedResults.totalEmployees++;

    try {
      const results = await exportEmployeeShiftsToCalendar(assignments, employee, timezone);
      
      if (results.success > 0) {
        aggregatedResults.successfulEmployees++;
      }
      
      aggregatedResults.totalEvents += employeeShifts.length;
      aggregatedResults.successfulEvents += results.success;
      aggregatedResults.failedEvents += results.failed;
      
      if (results.errors.length > 0) {
        aggregatedResults.errors.push({
          employee: employee.name,
          errors: results.errors
        });
      }
    } catch (error) {
      aggregatedResults.errors.push({
        employee: employee.name,
        error: error.message
      });
      console.error(`Failed to export shifts for ${employee.name}:`, error);
    }
  }

  return aggregatedResults;
}

/**
 * Check if user is currently authenticated with Google Calendar
 */
export function isAuthenticated() {
  return gapi?.client?.getToken() !== null;
}

/**
 * Sign out from Google Calendar
 */
export function signOut() {
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token);
    gapi.client.setToken(null);
  }
}
