/**
 * SettingsTab Component
 * Allows manual editing of shift generation settings like min/max staff per shift type
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, RefreshCw, AlertCircle, CheckCircle, Plus, Trash2, Shield, Mail, Download, Upload, FileText, Link, Send, Clock, ChevronDown, Users } from 'lucide-react';
import { testWebhook } from '../services/webhookService';
import { saveShiftSettings, loadShiftSettings, saveAdminEmails, loadAdminEmails, loadTeamMembers, deleteTeamMembers, saveTeamMembers } from '../services/firebaseService';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { useAuth } from '../contexts/AuthContext';
import { SHIFT_TYPES, getShiftDisplayName, ALL_SHIFT_TYPES } from '../constants/shifts';
import { notifySlack } from '../services/api';
import { ref, get, set } from 'firebase/database';
import getFirebase from '../services/lazyFirebase';

export default function SettingsTab({ isAdmin, employees: initialEmployees = [] }) {
  const { reloadAdminEmails, getIdToken } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  // Admin management state
  const [adminEmails, setAdminEmails] = useState([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [savingAdmins, setSavingAdmins] = useState(false);
  const [adminMessage, setAdminMessage] = useState(null);
  const [adminError, setAdminError] = useState(null);

  // Export/Import state
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportMessage, setExportMessage] = useState(null);
  const [importMessage, setImportMessage] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [importError, setImportError] = useState(null);
  const [exportingLeaves, setExportingLeaves] = useState(false);

  // Employee management state
  const [employees, setEmployees] = useState(initialEmployees);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Slack test state
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackTestMessage, setSlackTestMessage] = useState(null);
  const [slackTestError, setSlackTestError] = useState(null);

  // Employee notes state
  const [employeeNotes, setEmployeeNotes] = useState({});
  const [savingAllNotes, setSavingAllNotes] = useState(false);
  const [notesSaveMessage, setNotesSaveMessage] = useState(null);

  // Notes state
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesMessage, setNotesMessage] = useState(null);
  const [notesError, setNotesError] = useState(null);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // External leave imports state
  const [importedLeaves, setImportedLeaves] = useState([]);
  const [loadingImports, setLoadingImports] = useState(false);
  const [importsError, setImportsError] = useState(null);
  const [importsMessage, setImportsMessage] = useState(null);
  const [importsCurrentPage, setImportsCurrentPage] = useState(1);
  const IMPORTS_PER_PAGE = 10;

  // Webhook state
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookMessage, setWebhookMessage] = useState(null);
  const [webhookError, setWebhookError] = useState(null);

  // Daily Slack notifications state
  const [slackNotificationSettings, setSlackNotificationSettings] = useState({
    enabled: false,
    notificationTime: '09:00', // 24-hour format HH:MM
    notifyOnWeekends: true,
    adminAssignments: [] // [{ email: string, employees: number[] }]
  });
  const [loadingSlackSettings, setLoadingSlackSettings] = useState(false);
  const [savingSlackSettings, setSavingSlackSettings] = useState(false);
  const [slackSettingsMessage, setSlackSettingsMessage] = useState(null);
  const [slackSettingsError, setSlackSettingsError] = useState(null);
  const [testingDailyNotification, setTestingDailyNotification] = useState(false);

  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const saved = localStorage.getItem('settingsCollapsedSections');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleSection = (sectionId) => {
    setCollapsedSections(prev => {
      const newState = { ...prev, [sectionId]: !prev[sectionId] };
      try {
        localStorage.setItem('settingsCollapsedSections', JSON.stringify(newState));
      } catch (e) {
        console.warn('Failed to save collapse state:', e);
      }
      return newState;
    });
  };

  // Load settings on mount
  useEffect(() => {
    loadSettings();
    loadAdmins();
    loadEmployeeList();
    loadNotes();
    loadImportedLeaves();
    loadEmployeeNotes();
    loadSlackNotificationSettings();
  }, []);

  const loadAdmins = async () => {
    try {
      const emails = await loadAdminEmails();
      // Ensure emails is an array
      const emailArray = Array.isArray(emails) ? emails : [];
      setAdminEmails(emailArray);
    } catch (err) {
      console.error('Error loading admin emails:', err);
      setAdminError(err.message);
      // Set default admins on error
      setAdminEmails([
        'kordzadze2002@gmail.com',
        'nino.gogoladze@example.com',
        'giga.melikidze@example.com'
      ]);
    }
  };

  const loadEmployeeList = async () => {
    setLoadingEmployees(true);
    try {
      const employeeData = await loadTeamMembers();
      console.log('Raw employee data from Firebase:', employeeData);
      console.log('Employee count:', employeeData?.length || 0);
      console.log('Employee IDs:', employeeData?.map(e => e?.id) || []);
      
      // Filter out any invalid entries
      const validEmployees = (employeeData || []).filter(emp => emp && emp.id && emp.name);
      console.log('Valid employees after filtering:', validEmployees.length);
      
      setEmployees(validEmployees);
    } catch (err) {
      console.error('Error loading employees:', err);
      setEmployees([]);
    } finally {
      setLoadingEmployees(false);
    }
  };

  const loadNotes = async () => {
    setLoadingNotes(true);
    setNotesError(null);
    try {
      const db = (await getFirebase()).db;
      const notesRef = ref(db, 'admin/schedule_generation_notes');
      const snapshot = await get(notesRef);
      const notesData = snapshot.val();
      setNotes(notesData || '');
    } catch (err) {
      console.error('Error loading notes:', err);
      setNotesError('Failed to load notes');
    } finally {
      setLoadingNotes(false);
    }
  };

  const loadImportedLeaves = async () => {
    setLoadingImports(true);
    setImportsError(null);
    setImportsMessage(null);
    try {
      const db = (await getFirebase()).db;
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());

      // Check past 4 weeks and future 6 weeks to ensure we catch all recent/upcoming imports
      const leaves = [];
      const weeksToCheck = new Set();
      
      for (let i = -4; i < 6; i++) {
        const checkDate = new Date(weekStart);
        checkDate.setDate(weekStart.getDate() + i * 7);
        const weekStr = checkDate.toISOString().slice(0, 10);
        
        // Add both the Sunday and the following day (Monday) to account for different week systems
        weeksToCheck.add(weekStr);
        const nextDay = new Date(checkDate);
        nextDay.setDate(nextDay.getDate() + 1);
        weeksToCheck.add(nextDay.toISOString().slice(0, 10));
      }

      for (const weekStr of weeksToCheck) {
        try {
          const leavesRef = ref(db, `schedules/${weekStr}/leaves`);
          const snapshot = await get(leavesRef);
          const leavesData = snapshot.val();

          if (leavesData && typeof leavesData === 'object') {
            Object.entries(leavesData).forEach(([leaveId, leaveRecord]) => {
              if (leaveRecord && leaveRecord.source === 'external') {
                leaves.push({
                  id: leaveId,
                  week: weekStr,
                  ...leaveRecord
                });
              }
            });
          }
        } catch (err) {
          console.warn(`Failed to load leaves for week ${weekStr}:`, err);
        }
      }

      // Sort by date, most recent first
      leaves.sort((a, b) => new Date(b.date) - new Date(a.date));
      setImportedLeaves(leaves);

      if (leaves.length === 0) {
        setImportsMessage('No external leave imports found');
      } else {
        setImportsMessage(`✅ Found ${leaves.length} external leave import(s)`);
      }
    } catch (err) {
      console.error('Error loading imported leaves:', err);
      setImportsError('Failed to load import status');
    } finally {
      setLoadingImports(false);
    }
  };

  const loadEmployeeNotes = async () => {
    try {
      const employeeData = await loadTeamMembers();
      const notesMap = {};
      (employeeData || []).forEach(emp => {
        if (emp && emp.id && emp.notes) {
          notesMap[emp.id] = emp.notes;
        }
      });
      setEmployeeNotes(notesMap);
    } catch (err) {
      console.error('Error loading employee notes:', err);
    }
  };

  const loadSlackNotificationSettings = async () => {
    setLoadingSlackSettings(true);
    setSlackSettingsError(null);
    try {
      const db = (await getFirebase()).db;
      const settingsRef = ref(db, 'admin/slack_notification_settings');
      const snapshot = await get(settingsRef);
      const settingsData = snapshot.val();
      
      if (settingsData) {
        // Handle both old object format and new array format
        let adminAssignments = settingsData.adminAssignments || [];
        if (!Array.isArray(adminAssignments)) {
          // Convert old object format to array
          adminAssignments = Object.entries(adminAssignments).map(([email, employees]) => ({
            email,
            employees: employees || []
          }));
        }
        
        setSlackNotificationSettings({
          enabled: settingsData.enabled || false,
          notificationTime: settingsData.notificationTime || '09:00',
          notifyOnWeekends: settingsData.notifyOnWeekends !== false, // default true
          adminAssignments
        });
      }
    } catch (err) {
      console.error('Error loading Slack notification settings:', err);
      setSlackSettingsError('Failed to load Slack notification settings');
    } finally {
      setLoadingSlackSettings(false);
    }
  };

  const saveSlackNotificationSettings = async () => {
    if (!isAdmin) {
      setSlackSettingsError('Only admins can save Slack notification settings');
      return;
    }

    setSavingSlackSettings(true);
    setSlackSettingsError(null);
    setSlackSettingsMessage(null);
    try {
      const db = (await getFirebase()).db;
      const settingsRef = ref(db, 'admin/slack_notification_settings');
      await set(settingsRef, slackNotificationSettings);
      setSlackSettingsMessage('✅ Slack notification settings saved successfully!');
      setTimeout(() => setSlackSettingsMessage(null), 3000);
    } catch (err) {
      console.error('Error saving Slack notification settings:', err);
      setSlackSettingsError('Failed to save Slack notification settings');
    } finally {
      setSavingSlackSettings(false);
    }
  };

  const testDailySlackNotification = async () => {
    setTestingDailyNotification(true);
    setSlackSettingsError(null);
    setSlackSettingsMessage(null);
    try {
      const token = await getIdToken();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };
      
      const API_BASE = import.meta.env.VITE_API_URL || 'https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app';
      const response = await fetch(`${API_BASE}/api/send-daily-shifts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          test_mode: true,
          date: new Date().toISOString().split('T')[0]
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setSlackSettingsMessage(`✅ Test notification sent! Sent to: ${result.sent_to?.join(', ') || 'admins'}`);
    } catch (err) {
      console.error('Error testing daily notification:', err);
      setSlackSettingsError(`Failed to send test notification: ${err.message}`);
    } finally {
      setTestingDailyNotification(false);
    }
  };

  const saveAllEmployeeNotes = async () => {
    if (!isAdmin) {
      alert('Only admins can save employee notes');
      return;
    }

    setSavingAllNotes(true);
    setNotesSaveMessage(null);
    try {
      // Load current employees
      const currentEmployees = await loadTeamMembers();
      
      // Filter out invalid entries
      const validEmployees = (currentEmployees || []).filter(emp => emp && emp.id && emp.name);
      
      if (validEmployees.length === 0) {
        throw new Error('No valid employees found in database');
      }

      // Update all employees with their notes
      const updatedEmployees = validEmployees.map(emp => {
        const note = employeeNotes[emp.id];
        const updatedEmp = { ...emp };
        
        // Only add notes property if there's actual content
        if (note && note.trim()) {
          updatedEmp.notes = note.trim();
        } else {
          // Remove notes property entirely if empty (Firebase doesn't accept undefined)
          delete updatedEmp.notes;
        }
        
        return updatedEmp;
      });

      // Save back to Firebase
      await saveTeamMembers(updatedEmployees);

      setNotesSaveMessage(`✅ Notes saved successfully for all employees!`);
      setTimeout(() => setNotesSaveMessage(null), 3000);
    } catch (err) {
      console.error('Error saving employee notes:', err);
      alert(`Failed to save notes: ${err.message}`);
    } finally {
      setSavingAllNotes(false);
    }
  };

  const handleTestWebhook = async () => {
    setTestingWebhook(true);
    setWebhookError(null);
    setWebhookMessage(null);
    try {
      const result = await testWebhook();
      if (result.success) {
        setWebhookMessage(`✅ Test delivered successfully (HTTP ${result.status})`);
      } else {
        setWebhookError(result.error || `Server responded ${result.status}`);
      }
    } catch (err) {
      setWebhookError(err.message);
    } finally {
      setTestingWebhook(false);
      setTimeout(() => setWebhookMessage(null), 5000);
    }
  };

  const saveNotes = async () => {
    if (!isAdmin) {
      setNotesError('Only admins can save notes');
      return;
    }

    setSavingNotes(true);
    setNotesError(null);
    setNotesMessage(null);
    try {
      const db = (await getFirebase()).db;
      const notesRef = ref(db, 'admin/schedule_generation_notes');
      await set(notesRef, notes);
      setNotesMessage('✅ Notes saved successfully!');
      setTimeout(() => setNotesMessage(null), 3000);
    } catch (err) {
      console.error('Error saving notes:', err);
      setNotesError('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const settingsData = await loadShiftSettings();
      
      if (settingsData) {
        // Settings exist in Firebase, use them
        setSettings(settingsData);
      } else {
        // No settings in Firebase yet, use defaults
        setSettings(getDefaultSettings());
      }
    } catch (err) {
      console.error('Error loading settings from Firebase:', err);
      setError(err.message);
      // Set default settings if load fails
      setSettings(getDefaultSettings());
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!isAdmin) {
      setError('Only admins can save settings');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      // Save to Firebase RTDB
      await saveShiftSettings(settings);
      setMessage('✅ Settings saved to Firebase successfully!');
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Error saving settings to Firebase:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateShiftDefinition = (shiftType, field, value) => {
    setSettings((prev) => ({
      ...prev,
      shift_definitions: {
        ...prev.shift_definitions,
        [shiftType]: {
          ...prev.shift_definitions[shiftType],
          [field]: parseInt(value, 10) || 0,
        },
      },
    }));
  };

  const updateShiftCombination = (comboNumber, shiftType, value) => {
    setSettings((prev) => ({
      ...prev,
      shift_combinations: {
        ...prev.shift_combinations,
        [comboNumber]: {
          ...prev.shift_combinations[comboNumber],
          [shiftType]: parseInt(value, 10) || 0,
        },
      },
    }));
  };

  const addShiftPattern = () => {
    if (!isAdmin) {
      setError('Only admins can add patterns');
      return;
    }
    
    const existingNumbers = Object.keys(settings.shift_combinations).map(k => parseInt(k, 10));
    const newNumber = Math.max(...existingNumbers, 0) + 1;
    
    setSettings((prev) => ({
      ...prev,
      shift_combinations: {
        ...prev.shift_combinations,
        [newNumber]: {
          morning: 0,
          day: 1,
          night: 2,
          afternoon: 2,
          description: `Custom Pattern ${newNumber}`,
        },
      },
    }));
    setMessage(`New pattern ${newNumber} added (total 5 shifts)`);
    setTimeout(() => setMessage(null), 2000);
  };

  const removeShiftPattern = (comboNumber) => {
    if (!isAdmin) {
      setError('Only admins can remove patterns');
      return;
    }
    
    if (Object.keys(settings.shift_combinations).length <= 1) {
      setError('Cannot remove the last pattern. You need at least one pattern.');
      return;
    }
    
    if (confirm(`Remove Pattern ${comboNumber}? This will affect future schedule generations.`)) {
      setSettings((prev) => {
        const updated = { ...prev.shift_combinations };
        delete updated[comboNumber];
        return {
          ...prev,
          shift_combinations: updated,
        };
      });
      setMessage(`Pattern ${comboNumber} removed`);
      setTimeout(() => setMessage(null), 2000);
    }
  };

  const resetToDefaults = () => {
    if (confirm('Reset all settings to defaults? This cannot be undone.')) {
      setSettings(getDefaultSettings());
      setMessage('Settings reset to defaults. Click Save to apply.');
    }
  };

  // Admin management functions
  const addAdminEmail = () => {
    if (!isAdmin) {
      setAdminError('Only admins can add admin emails');
      return;
    }

    const email = newAdminEmail.trim().toLowerCase();
    
    if (!email) {
      setAdminError('Please enter an email address');
      return;
    }

    if (!email.endsWith('@example.com')) {
      setAdminError('Only @example.com emails can be admins');
      return;
    }

    if (adminEmails.includes(email)) {
      setAdminError('This email is already an admin');
      return;
    }

    setAdminEmails([...adminEmails, email]);
    setNewAdminEmail('');
    setAdminError(null);
    setAdminMessage(`Added ${email} - Click Save to apply`);
    setTimeout(() => setAdminMessage(null), 3000);
  };

  const removeAdminEmail = (email) => {
    if (!isAdmin) {
      setAdminError('Only admins can remove admin emails');
      return;
    }

    if (adminEmails.length <= 1) {
      setAdminError('Cannot remove the last admin. At least one admin is required.');
      return;
    }

    if (confirm(`Remove admin privileges for ${email}?`)) {
      setAdminEmails(adminEmails.filter(e => e !== email));
      setAdminMessage(`Removed ${email} - Click Save to apply`);
      setTimeout(() => setAdminMessage(null), 3000);
    }
  };

  const saveAdmins = async () => {
    if (!isAdmin) {
      setAdminError('Only admins can save admin emails');
      return;
    }

    if (adminEmails.length === 0) {
      setAdminError('At least one admin is required');
      return;
    }

    setSavingAdmins(true);
    setAdminError(null);
    setAdminMessage(null);
    
    try {
      await saveAdminEmails(adminEmails);
      await reloadAdminEmails(); // Reload in AuthContext
      setAdminMessage('✅ Admin emails saved successfully!');
      setTimeout(() => setAdminMessage(null), 3000);
    } catch (err) {
      console.error('Error saving admin emails:', err);
      setAdminError(err.message);
    } finally {
      setSavingAdmins(false);
    }
  };

  /**
   * Export all site data organized by categories, months, and weeks
   */
  const handleExportAllData = async () => {
    if (!isAdmin) {
      setExportError('Only admins can export data');
      return;
    }

    setExporting(true);
    setExportError(null);
    setExportMessage(null);

    try {
      const { db } = await getFirebase();
      const dbRef = ref(db);

      // 1. Load all schedules
      const schedulesSnapshot = await get(ref(db, 'schedules'));
      const schedules = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};

      // 2. Load team members (employees)
      const employees = await loadTeamMembers();

      // 3. Load shift swap requests
      const swapRequestsSnapshot = await get(ref(db, 'shiftSwapRequests'));
      const swapRequests = swapRequestsSnapshot.exists() ? swapRequestsSnapshot.val() : {};

      // 4. Load shift settings
      const shiftSettings = await loadShiftSettings();

      // 5. Load admin emails
      const admins = await loadAdminEmails();

      // Organize schedules by year and month
      const organizedSchedules = {};
      Object.entries(schedules).forEach(([weekStart, scheduleData]) => {
        const date = new Date(weekStart);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const yearMonth = `${year}-${month}`;

        if (!organizedSchedules[year]) {
          organizedSchedules[year] = {};
        }
        if (!organizedSchedules[year][yearMonth]) {
          organizedSchedules[year][yearMonth] = {
            weeks: {}
          };
        }

        organizedSchedules[year][yearMonth].weeks[weekStart] = {
          weekStart,
          assignments: scheduleData.assignments || [],
          leaves: scheduleData.leaves || {},
          metadata: {
            savedAt: scheduleData.savedAt,
            savedBy: scheduleData.savedBy,
            lastSwapApplied: scheduleData.lastSwapApplied
          }
        };
      });

      // Organize swap requests by status and date
      const organizedSwapRequests = {
        pending: [],
        approved: [],
        rejected: [],
        all: []
      };

      Object.entries(swapRequests).forEach(([id, request]) => {
        const requestWithId = { id, ...request };
        organizedSwapRequests.all.push(requestWithId);
        
        const status = request.status || 'pending';
        if (organizedSwapRequests[status]) {
          organizedSwapRequests[status].push(requestWithId);
        }
      });

      // Create comprehensive export object
      const exportData = {
        exportMetadata: {
          exportedAt: new Date().toISOString(),
          exportedBy: useAuth.user?.email || 'unknown',
          version: '1.0',
          description: 'CS Scheduler - Complete Data Export'
        },
        schedules: {
          byYearMonth: organizedSchedules,
          totalWeeks: Object.keys(schedules).length
        },
        employees: {
          active: employees.filter(emp => emp.isActive !== false),
          inactive: employees.filter(emp => emp.isActive === false),
          total: employees.length
        },
        swapRequests: organizedSwapRequests,
        settings: {
          shiftSettings,
          adminEmails: admins
        },
        statistics: {
          totalSchedules: Object.keys(schedules).length,
          totalEmployees: employees.length,
          totalSwapRequests: Object.keys(swapRequests).length,
          dateRange: {
            earliest: Object.keys(schedules).sort()[0] || null,
            latest: Object.keys(schedules).sort().reverse()[0] || null
          }
        }
      };

      // Create downloadable JSON file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cs-scheduler-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportMessage(`✅ Export complete! Downloaded ${exportData.statistics.totalSchedules} weeks, ${exportData.statistics.totalEmployees} employees, ${exportData.statistics.totalSwapRequests} swap requests.`);
      setTimeout(() => setExportMessage(null), 5000);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  /**
   * Export all leaves as CSV
   */
  const handleExportLeavesAsCSV = async () => {
    if (!isAdmin) {
      setExportError('Only admins can export data');
      return;
    }

    setExportingLeaves(true);
    setExportError(null);
    setExportMessage(null);

    try {
      const { db } = await getFirebase();

      // Load employees for name mapping
      const employeesList = await loadTeamMembers();
      const employeeMap = {};
      employeesList.forEach(emp => {
        employeeMap[emp.id] = emp.name;
      });

      // Collect all leaves from the entire database
      // This ensures we capture any leaves, even orphaned ones not in active schedules
      const allLeaves = [];
      
      // 1. Load all schedules and their leaves
      const schedulesSnapshot = await get(ref(db, 'schedules'));
      const schedules = schedulesSnapshot.exists() ? schedulesSnapshot.val() : {};
      
      Object.entries(schedules).forEach(([weekStart, scheduleData]) => {
        if (scheduleData.leaves && typeof scheduleData.leaves === 'object') {
          Object.entries(scheduleData.leaves).forEach(([leaveId, leave]) => {
            processLeave(leave, leaveId, allLeaves, employeeMap);
          });
        }
      });
      
      // 2. Also check for any leaves at root level (just in case)
      const rootLeavesSnapshot = await get(ref(db, 'leaves'));
      if (rootLeavesSnapshot.exists()) {
        const rootLeaves = rootLeavesSnapshot.val();
        if (typeof rootLeaves === 'object') {
          Object.entries(rootLeaves).forEach(([leaveId, leave]) => {
            // Only add if not already in allLeaves
            if (!allLeaves.find(l => l.id === leave.id || (l.date === leave.date && l.employee_id === leave.employee_id))) {
              processLeave(leave, leaveId, allLeaves, employeeMap);
            }
          });
        }
      }

      // Sort by date
      allLeaves.sort((a, b) => a.date.localeCompare(b.date));

      console.log(`📋 Exporting ${allLeaves.length} total leaves (including any orphaned leaves)`);

      // Convert to CSV using Papa Parse
      const csv = Papa.unparse(allLeaves, {
        header: true,
        columns: ['date', 'employee_id', 'employee_name', 'leave_type', 'timeframe', 'shift_type', 'leave_hours', 'work_hours', 'custom_start', 'custom_end', 'created_at', 'created_by']
      });

      // Create downloadable CSV file
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `cs-scheduler-leaves-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setExportMessage(`✅ Export complete! Downloaded ${allLeaves.length} leave records.`);
      setTimeout(() => setExportMessage(null), 5000);
    } catch (err) {
      console.error('Export leaves failed:', err);
      setExportError(`Export failed: ${err.message}`);
    } finally {
      setExportingLeaves(false);
    }
  };

  /**
   * Helper function to process a leave record
   */
  const processLeave = (leave, leaveId, allLeavesArray, employeeMap) => {
    // Calculate leave hours
    const SHIFT_HOURS = {
      morning: 8,
      day: 8,
      afternoon: 8,
      night: 8
    };
    
    const shiftHours = SHIFT_HOURS[leave.shift_type] || 8;
    let leaveHours = 0;
    
    if (leave.timeframe === 'all-day') {
      leaveHours = shiftHours;
    } else if (leave.timeframe === 'first-half' || leave.timeframe === 'second-half') {
      leaveHours = shiftHours / 2;
    } else if (leave.timeframe === 'other' && leave.custom_start && leave.custom_end) {
      try {
        const startParts = leave.custom_start.split(':');
        const endParts = leave.custom_end.split(':');
        const startMins = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
        const endMins = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
        leaveHours = (endMins - startMins) / 60;
      } catch (e) {
        leaveHours = 0;
      }
    }
    leaveHours = Math.max(0, Math.round(leaveHours * 100) / 100);
    
    // Work hours is the remaining hours after leave (shift hours - leave hours)
    const workHours = Math.max(0, Math.round((shiftHours - leaveHours) * 100) / 100);
    
    allLeavesArray.push({
      date: leave.date || '',
      employee_id: leave.employee_id || '',
      employee_name: employeeMap[leave.employee_id] || leave.employee_name || '',
      leave_type: leave.leave_type || '',
      timeframe: leave.timeframe || '',
      shift_type: leave.shift_type || '',
      leave_hours: leaveHours,
      work_hours: workHours,
      custom_start: leave.custom_start || '',
      custom_end: leave.custom_end || '',
      created_at: leave.createdAt || '',
      created_by: leave.createdBy || '',
      id: leave.id || leaveId
    });
  };

  /**
   * Export all leaves as CSV (updated version)
   */

  /**
   * Import all data from a backup file
   */
  const handleImportAllData = async (event) => {
    if (!isAdmin) {
      setImportError('Only admins can import data');
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setImportError('Please select a valid JSON backup file');
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportMessage(null);

    try {
      const fileContent = await file.text();
      const importData = JSON.parse(fileContent);

      // Validate import data structure
      if (!importData.exportMetadata || !importData.schedules || !importData.employees) {
        throw new Error('Invalid backup file format. Missing required data.');
      }

      const { db } = await getFirebase();

      // Confirm before importing
      const confirmMessage = `Import data from backup?\n\n` +
        `Schedules: ${importData.statistics?.totalSchedules || 0} weeks\n` +
        `Employees: ${importData.statistics?.totalEmployees || 0}\n` +
        `Swap Requests: ${importData.statistics?.totalSwapRequests || 0}\n\n` +
        `Exported: ${new Date(importData.exportMetadata.exportedAt).toLocaleString()}\n\n` +
        `⚠️ This will MERGE with existing data. Duplicate weeks will be overwritten.`;

      if (!confirm(confirmMessage)) {
        setImporting(false);
        return;
      }

      let schedulesImported = 0;
      let employeesImported = 0;
      let swapRequestsImported = 0;

      // 1. Import schedules organized by year/month
      if (importData.schedules?.byYearMonth) {
        for (const [year, months] of Object.entries(importData.schedules.byYearMonth)) {
          for (const [yearMonth, monthData] of Object.entries(months)) {
            for (const [weekStart, weekData] of Object.entries(monthData.weeks)) {
              const scheduleRef = ref(db, `schedules/${weekStart}`);
              const scheduleData = {
                weekStart: weekData.weekStart,
                assignments: weekData.assignments,
                leaves: weekData.leaves || {},
                savedAt: weekData.metadata?.savedAt || new Date().toISOString(),
                savedBy: weekData.metadata?.savedBy || 'imported'
              };
              
              // Only add lastSwapApplied if it exists (avoid undefined)
              if (weekData.metadata?.lastSwapApplied !== undefined) {
                scheduleData.lastSwapApplied = weekData.metadata.lastSwapApplied;
              }
              
              await set(scheduleRef, scheduleData);
              schedulesImported++;
            }
          }
        }
      }

      // 2. Import employees (merge with existing, don't overwrite)
      if (importData.employees) {
        const allEmployees = [
          ...(importData.employees.active || []),
          ...(importData.employees.inactive || [])
        ];
        
        const currentEmployees = await loadTeamMembers();
        const currentIds = new Set(currentEmployees.map(e => e.id));

        for (const employee of allEmployees) {
          if (!currentIds.has(employee.id)) {
            const employeeRef = ref(db, `teamMembers/${employee.id}`);
            await set(employeeRef, employee);
            employeesImported++;
          }
        }
      }

      // 3. Import swap requests (merge with existing)
      if (importData.swapRequests?.all) {
        for (const request of importData.swapRequests.all) {
          const { id, ...requestData } = request;
          const requestRef = ref(db, `shiftSwapRequests/${id}`);
          await set(requestRef, requestData);
          swapRequestsImported++;
        }
      }

      // 4. Import settings (optional - ask user)
      if (importData.settings?.shiftSettings) {
        if (confirm('Import shift settings? This will overwrite current settings.')) {
          await saveShiftSettings(importData.settings.shiftSettings);
          setSettings(importData.settings.shiftSettings);
        }
      }

      if (importData.settings?.adminEmails) {
        if (confirm('Import admin email list? This will overwrite current admins.')) {
          await saveAdminEmails(importData.settings.adminEmails);
          setAdminEmails(importData.settings.adminEmails);
          await reloadAdminEmails();
        }
      }

      setImportMessage(
        `✅ Import complete!\n\n` +
        `• Schedules imported: ${schedulesImported}\n` +
        `• New employees added: ${employeesImported}\n` +
        `• Swap requests imported: ${swapRequestsImported}\n\n` +
        `Please refresh the page to see all imported data.`
      );

      // Reset file input
      event.target.value = '';
    } catch (err) {
      console.error('Import failed:', err);
      setImportError(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const handleExportEmployeesCSV = () => {
    if (employees.length === 0) {
      alert('No employees to export');
      return;
    }

    // Clean and prepare employee data for CSV
    const cleanEmployees = employees
      .filter(emp => emp && emp.id && emp.name)
      .map(emp => ({
        id: emp.id,
        name: emp.name,
        email: emp.email || ''
      }));
    
    const csvData = Papa.unparse(cleanEmployees);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `employees-${new Date().toISOString().split('T')[0]}.csv`);
  };

  const handleImportEmployeesCSV = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isAdmin) {
      alert('Only admins can import employees');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const importedEmployees = results.data
          .map((row, index) => ({
            id: parseInt(row.id) || (index + 1),
            name: row.name || row.Name || '',
            email: row.email || row.Email || '',
          }))
          .filter(emp => emp.name && emp.name.trim());
        
        if (importedEmployees.length === 0) {
          alert('No valid employees found in the CSV file.');
          event.target.value = '';
          return;
        }

        const confirmMessage = `Import ${importedEmployees.length} employees from CSV?\n\nThis will replace all existing employees.`;
        if (!confirm(confirmMessage)) {
          event.target.value = '';
          return;
        }

        setLoadingEmployees(true);
        try {
          await saveTeamMembers(importedEmployees);
          setEmployees(importedEmployees);
          alert(`✅ Successfully imported ${importedEmployees.length} employees!`);
          
          // Reload to confirm
          await loadEmployeeList();
        } catch (error) {
          console.error('Failed to import employees:', error);
          alert(`❌ Failed to import employees: ${error.message}`);
        } finally {
          setLoadingEmployees(false);
          event.target.value = '';
        }
      },
      error: (error) => {
        console.error('CSV parsing error:', error);
        alert(`❌ Failed to parse CSV: ${error.message}`);
        event.target.value = '';
      }
    });
  };

  const checkFeasibility = () => {
    setError(null);
    setMessage(null);
    const issues = [];
    const warnings = [];

    // Use actual employee count from loaded data, with fallback to 10
    const NUM_EMPLOYEES = employees && employees.length > 0 ? employees.length : 10;
    const SHIFTS_PER_EMPLOYEE = 5;
    const DAYS_PER_WEEK = 7;
    const TOTAL_AVAILABLE_SLOTS = NUM_EMPLOYEES * SHIFTS_PER_EMPLOYEE;

    const shiftDefs = settings.shift_definitions || {};

    // NOTE: Pattern-based feasibility check removed - using direct constraint satisfaction
    // The solver now automatically assigns shifts without pre-defined patterns

    // 1. Check min > max violations
    ['morning', 'day', 'afternoon', 'night'].forEach((shiftType) => {
      const minStaff = shiftDefs[shiftType]?.min_staff || 1;
      const maxStaff = shiftDefs[shiftType]?.max_staff || 5;
      if (minStaff > maxStaff) {
        const displayName = getShiftDisplayName(shiftType);
        issues.push(`❌ ${displayName}: min_staff (${minStaff}) > max_staff (${maxStaff}). Impossible constraint.`);
      }
    });

    if (issues.length > 0) {
      setError(`❌ INVALID CONSTRAINTS\n\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n\n')}`);
      return;
    }

    // 2. Calculate total minimum and maximum coverage needed
    const totalMinRequired = ['morning', 'day', 'afternoon', 'night'].reduce((sum, st) => 
      sum + ((shiftDefs[st]?.min_staff || 1) * DAYS_PER_WEEK), 0
    );

    const totalMaxAllowed = ['morning', 'day', 'afternoon', 'night'].reduce((sum, st) => 
      sum + ((shiftDefs[st]?.max_staff || 5) * DAYS_PER_WEEK), 0
    );

    // 3. Check total capacity feasibility
    if (totalMinRequired > TOTAL_AVAILABLE_SLOTS) {
      const shortfall = totalMinRequired - TOTAL_AVAILABLE_SLOTS;
      issues.push(
        `❌ Total coverage exceeds capacity:\n` +
        `   • Minimum required: ${totalMinRequired} shifts\n` +
        `   • Available slots: ${TOTAL_AVAILABLE_SLOTS} (${NUM_EMPLOYEES} employees × ${SHIFTS_PER_EMPLOYEE} shifts)\n` +
        `   • Shortfall: ${shortfall} shifts\n` +
        `   Fix: Reduce min_staff across shift types or add more employees.`
      );
    }

    // 4. Warn if coverage range is too tight (12-hour rest may cause issues)
    const utilizationMin = Math.round((totalMinRequired / TOTAL_AVAILABLE_SLOTS) * 100);
    const utilizationMax = Math.round((totalMaxAllowed / TOTAL_AVAILABLE_SLOTS) * 100);

    if (utilizationMin > 90) {
      warnings.push(
        `⚠️ High minimum utilization (${utilizationMin}%):\n` +
        `   • With 12-hour rest constraints, tight schedules may be infeasible.\n` +
        `   • Consider reducing min_staff or adding more employees.`
      );
    }

    // 5. Check per-shift-type feasibility
    ['morning', 'day', 'afternoon', 'night'].forEach((shiftType) => {
      const minRequired = (shiftDefs[shiftType]?.min_staff || 1) * DAYS_PER_WEEK;
      const maxAllowed = (shiftDefs[shiftType]?.max_staff || 5) * DAYS_PER_WEEK;
      const displayName = getShiftDisplayName(shiftType);

      // Each employee works 5 shifts, so theoretical max per shift type is 5 * NUM_EMPLOYEES
      const theoreticalMaxForShiftType = NUM_EMPLOYEES * SHIFTS_PER_EMPLOYEE;

      if (minRequired > theoreticalMaxForShiftType) {
        issues.push(
          `❌ ${displayName} minimum coverage impossible:\n` +
          `   • Minimum required: ${minRequired} shifts (${shiftDefs[shiftType]?.min_staff}/day × ${DAYS_PER_WEEK} days)\n` +
          `   • Theoretical maximum: ${theoreticalMaxForShiftType} shifts (${NUM_EMPLOYEES} employees × ${SHIFTS_PER_EMPLOYEE} shifts)\n` +
          `   Fix: Reduce min_staff for ${shiftType} or add more employees.`
        );
      }
    });

    // Display results
    if (issues.length === 0 && warnings.length === 0) {
      setMessage(
        `✅ Feasibility check passed!\n\n` +
        `With ${NUM_EMPLOYEES} employees:\n` +
        `• Total slots available: ${TOTAL_AVAILABLE_SLOTS} (${NUM_EMPLOYEES} × ${SHIFTS_PER_EMPLOYEE} shifts)\n` +
        `• Minimum coverage needed: ${totalMinRequired} shifts (${utilizationMin}% utilization)\n` +
        `• Maximum coverage allowed: ${totalMaxAllowed} shifts (${utilizationMax}% utilization)\n\n` +
        `Shift type requirements:\n` +
        ['morning', 'day', 'afternoon', 'night'].map(st => {
          const min = (shiftDefs[st]?.min_staff || 1) * DAYS_PER_WEEK;
          const max = (shiftDefs[st]?.max_staff || 5) * DAYS_PER_WEEK;
          const displayName = getShiftDisplayName(st);
          return `• ${displayName}: ${min}–${max} shifts/week`;
        }).join('\n')
      );
      return;
    }

    if (issues.length > 0) {
      setError(
        `❌ INFEASIBLE - Found ${issues.length} critical issue(s):\n\n${issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n\n')}`
      );
    } else if (warnings.length > 0) {
      setMessage(
        `⚠️ Feasibility check passed with warnings:\n\n${warnings.map((w, idx) => `${idx + 1}. ${w}`).join('\n\n')}\n\n` +
        `Schedules should be possible but may require solver tuning.`
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-gray-600">Loading settings...</span>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center space-x-2">
          <AlertCircle className="text-red-600" size={20} />
          <span className="text-red-800">Failed to load settings</span>
        </div>
      </div>
    );
  }

  const shiftTypes = Object.keys(settings.shift_definitions || {});

  // Collapsible Section Component
  const CollapsibleSection = ({ id, title, icon: Icon, iconColor, description, children, adminOnly = false }) => {
    if (adminOnly && !isAdmin) return null;
    
    const isCollapsed = collapsedSections[id];
    
    return (
      <div className="bg-white rounded-lg shadow">
        <div 
          className="p-6 cursor-pointer select-none"
          onClick={() => toggleSection(id)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 flex-1">
              <Icon className={iconColor} size={24} />
              <div className="flex-1">
                <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                {description && (
                  <p className="text-gray-600 text-sm mt-1">{description}</p>
                )}
              </div>
            </div>
            <motion.div
              animate={{ rotate: isCollapsed ? 0 : 180 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="text-gray-500" size={20} />
            </motion.div>
          </div>
        </div>
        
        <motion.div
          initial={false}
          animate={{
            height: isCollapsed ? 0 : "auto",
            opacity: isCollapsed ? 0 : 1
          }}
          transition={{
            height: { duration: 0.3, ease: "easeInOut" },
            opacity: { duration: 0.2, ease: "easeInOut" }
          }}
          style={{ overflow: "hidden", position: "relative" }}
        >
          <div className="px-6 pb-6" style={{ position: "relative" }}>
            {children}
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" style={{ position: "relative" }}>

      {/* Schedule Generation Notes Section */}
      <CollapsibleSection
        id="schedule-notes"
        title="Schedule Generation Notes"
        icon={FileText}
        iconColor="text-purple-600"
        description="Add global notes that will be displayed to all admins during shift generation."
        adminOnly={true}
      >
        <div>
          {notesMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <CheckCircle className="text-green-600" size={16} />
                <span className="text-green-800 text-sm">{notesMessage}</span>
              </div>
            </motion.div>
          )}

          {notesError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{notesError}</span>
              </div>
            </motion.div>
          )}

          {loadingNotes ? (
            <div className="text-center py-8 text-gray-500">Loading notes...</div>
          ) : (
            <>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes or reminders for shift generation... These will be visible to all admins during the scheduling process."
                className="w-full h-40 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none font-mono text-sm"
              />
              <div className="mt-4 flex justify-end">
                <button
                  onClick={saveNotes}
                  disabled={savingNotes}
                  className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Save size={18} />
                  <span>{savingNotes ? 'Saving...' : 'Save Notes'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* External Leave Imports Status Section */}
      <CollapsibleSection
        id="external-leave-imports"
        title="External Leave Imports"
        icon={Mail}
        iconColor="text-blue-600"
        description="Monitor leave imports from external HR systems. Shows recent imports with auto-created day shifts for missing days."
        adminOnly={true}
      >
        <div>
          <div className="mb-4">
            <div className="flex justify-end">
              <button
                onClick={loadImportedLeaves}
                disabled={loadingImports}
                className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 text-sm flex items-center space-x-1"
              >
                <RefreshCw size={16} className={loadingImports ? 'animate-spin' : ''} />
                <span>{loadingImports ? 'Checking...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {importsMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <CheckCircle className="text-green-600" size={16} />
                <span className="text-green-800 text-sm">{importsMessage}</span>
              </div>
            </motion.div>
          )}

          {importsError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{importsError}</span>
              </div>
            </motion.div>
          )}

          {(() => {
            const getEmployeeName = (empId) => {
              const emp = employees.find(e => String(e.id) === String(empId));
              return emp ? emp.name : null;
            };
            const formatImportTime = (ts) => {
              if (!ts) return '—';
              try {
                const d = new Date(ts);
                if (isNaN(d.getTime())) return String(ts);
                return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
              } catch { return '—'; }
            };
            const totalPages = Math.ceil(importedLeaves.length / IMPORTS_PER_PAGE);
            const startIdx = (importsCurrentPage - 1) * IMPORTS_PER_PAGE;
            const endIdx = startIdx + IMPORTS_PER_PAGE;
            const currentPageLeaves = importedLeaves.slice(startIdx, endIdx);
            
            return loadingImports ? (
              <div className="text-center py-8 text-gray-500">Loading import status...</div>
            ) : importedLeaves.length === 0 ? (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">No external leave imports yet</p>
                    <p className="mt-1">Imported leaves will appear here once the webhook receives data from your HR system.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="overflow-x-auto">
                  <div className="min-w-[720px]">
                    {/* Header */}
                    <div className="flex items-center text-xs text-gray-500 font-semibold mb-2 px-3">
                      <span className="w-40 shrink-0">Employee</span>
                      <span className="w-24 shrink-0">Date</span>
                      <span className="w-22 shrink-0">Shift Type</span>
                      <span className="w-24 shrink-0">Timeframe</span>
                      <span className="w-20 shrink-0">Leave Type</span>
                      <span className="w-20 shrink-0">Status</span>
                      <span className="flex-1 text-right">Updated</span>
                    </div>
                    {currentPageLeaves.map((leave, idx) => {
                    const empName = getEmployeeName(leave.employee_id);
                    const ts = leave.updatedAt || leave.createdAt;
                    const isUpdated = !!leave.updatedAt;
                    return (
                      <motion.div
                        key={leave.id}
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-center bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 mb-1.5"
                      >
                        <div className="w-40 shrink-0 min-w-0 pr-2">
                          {empName ? (
                            <>
                              <div className="text-sm font-medium text-gray-800 truncate">{empName}</div>
                              <div className="text-xs text-gray-400 font-mono">#{leave.employee_id}</div>
                            </>
                          ) : (
                            <div className="text-sm font-mono text-gray-600">#{leave.employee_id}</div>
                          )}
                        </div>
                        <span className="w-24 shrink-0 text-sm text-gray-700">{leave.date}</span>
                        <span className="w-22 shrink-0">
                          {leave.shift_type ? (
                            <span className="inline-block bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs font-mono">
                              {leave.shift_type}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </span>
                        <span className="w-24 shrink-0">
                          <span className="inline-block bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">
                            {leave.timeframe || '—'}
                          </span>
                        </span>
                        <span className="w-20 shrink-0">
                          <span className="inline-block bg-green-100 text-green-800 px-2 py-0.5 rounded text-xs">
                            {leave.leave_type || '—'}
                          </span>
                        </span>
                        <span className="w-20 shrink-0">
                          <span className="inline-flex items-center space-x-1">
                            <CheckCircle size={13} className="text-green-600 shrink-0" />
                            <span className="text-xs text-gray-600">{leave.status || 'imported'}</span>
                          </span>
                        </span>
                        <span className="flex-1 text-right">
                          <span className="inline-flex items-center justify-end space-x-1 text-xs text-gray-500">
                            <Clock size={11} className="shrink-0" />
                            <span className={isUpdated ? 'text-amber-600 font-medium' : ''}>{formatImportTime(ts)}</span>
                            {isUpdated && <span className="text-amber-500 text-xs">(updated)</span>}
                          </span>
                        </span>
                      </motion.div>
                    );
                  })}
                  </div>
                </div>
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between px-3">
                    <div className="text-sm text-gray-600">
                      Showing {startIdx + 1}-{Math.min(endIdx, importedLeaves.length)} of {importedLeaves.length}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setImportsCurrentPage(p => Math.max(1, p - 1))}
                        disabled={importsCurrentPage === 1}
                        className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-600">
                        Page {importsCurrentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setImportsCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={importsCurrentPage === totalPages}
                        className="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">How external imports work:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Your HR system sends leave requests to the <code className="bg-blue-200 px-1 rounded text-xs">/api/import-leaves</code> webhook</li>
                  <li>Auto-creates "Day" shifts (10:00–19:00) for days without existing shifts</li>
                  <li>All-day leaves skip the day entirely; partial leaves deduct time from shifts</li>
                  <li>Marks imported leaves with <code className="bg-blue-200 px-1 rounded text-xs">source: 'external'</code> for tracking</li>
                  <li>Prevents duplicates: same employee + date won't be imported twice</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Data Backup & Restore Section */}
      <CollapsibleSection
        id="data-backup-restore"
        title="Data Backup & Restore"
        icon={Download}
        iconColor="text-blue-600"
        description="Export all site data (schedules, employees, swap requests) organized by months and weeks. Import backup files to restore lost data."
        adminOnly={true}
      >
        <div>

          {/* Export/Import Messages */}
          {exportMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-start space-x-2">
                <CheckCircle className="text-green-600 flex-shrink-0 mt-0.5" size={16} />
                <pre className="text-green-800 text-sm whitespace-pre-wrap">{exportMessage}</pre>
              </div>
            </motion.div>
          )}

          {exportError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{exportError}</span>
              </div>
            </motion.div>
          )}

          {importMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-start space-x-2">
                <CheckCircle className="text-green-600 flex-shrink-0 mt-0.5" size={16} />
                <pre className="text-green-800 text-sm whitespace-pre-wrap">{importMessage}</pre>
              </div>
            </motion.div>
          )}

          {importError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{importError}</span>
              </div>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Export All Data Button */}
            <button
              onClick={handleExportAllData}
              disabled={exporting}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {exporting ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <Download size={20} />
                  <span>Export All Data</span>
                </>
              )}
            </button>

            {/* Export Leaves as CSV Button */}
            <button
              onClick={handleExportLeavesAsCSV}
              disabled={exportingLeaves}
              className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {exportingLeaves ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  <span>Exporting...</span>
                </>
              ) : (
                <>
                  <Download size={20} />
                  <span>Export Leaves (CSV)</span>
                </>
              )}
            </button>

            {/* Import Button */}
            <label className="flex-1">
              <input
                type="file"
                accept=".json"
                onChange={handleImportAllData}
                disabled={importing}
                className="hidden"
              />
              <div className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center space-x-2">
                {importing ? (
                  <>
                    <RefreshCw className="animate-spin" size={20} />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Upload size={20} />
                    <span>Import All Data</span>
                  </>
                )}
              </div>
            </label>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">How backup works:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><strong>Export</strong>: Downloads a JSON file with all schedules, employees, and settings organized by year/month/week</li>
                  <li><strong>Import</strong>: Restores data from backup file (merges with existing data, overwrites duplicate weeks)</li>
                  <li>Backup files include metadata: export date, total records, date ranges</li>
                  <li>Schedule data is organized hierarchically: Year → Month → Week for easy navigation</li>
                  <li>Safe to import: You'll be asked to confirm before any changes are made</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Admin Management Section */}
      <CollapsibleSection
        id="admin-management"
        title="Admin Management"
        icon={Shield}
        iconColor="text-purple-600"
        description="Manage who has admin privileges. Admins can generate schedules, modify settings, and manage team members."
        adminOnly={true}
      >
        <div>

          {/* Admin Messages */}
          {adminMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <CheckCircle className="text-green-600" size={16} />
                <span className="text-green-800 text-sm">{adminMessage}</span>
              </div>
            </motion.div>
          )}

          {adminError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{adminError}</span>
              </div>
            </motion.div>
          )}

          {/* Current Admins List */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Current Admins ({adminEmails.length})</h4>
            <div className="space-y-2">
              {adminEmails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between bg-gray-50 rounded-lg p-3 border border-gray-200"
                >
                  <div className="flex items-center space-x-2">
                    <Mail className="text-gray-500" size={16} />
                    <span className="text-gray-800 font-medium">{email}</span>
                  </div>
                  <button
                    onClick={() => removeAdminEmail(email)}
                    disabled={adminEmails.length <= 1}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={adminEmails.length <= 1 ? "Cannot remove last admin" : "Remove admin"}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Add New Admin */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Add New Admin</h4>
            <div className="flex space-x-2">
              <input
                type="email"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addAdminEmail()}
                placeholder="email@example.com"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={addAdminEmail}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center space-x-2"
              >
                <Plus size={16} />
                <span>Add</span>
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Only @example.com emails can be added as admins</p>
          </div>

          {/* Save Admins Button */}
          <div className="flex justify-end">
            <button
              onClick={saveAdmins}
              disabled={savingAdmins}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {savingAdmins ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Save Admin List</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-50 border border-green-200 rounded-lg p-4"
        >
          <div className="flex items-start space-x-3">
            <CheckCircle className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
            <pre className="text-green-800 font-mono text-sm whitespace-pre-wrap break-words flex-1">{message}</pre>
          </div>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 rounded-lg p-4"
        >
          <div className="flex items-start space-x-3">
            <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
            <pre className="text-red-800 font-mono text-sm whitespace-pre-wrap break-words flex-1">{error}</pre>
          </div>
        </motion.div>
      )}

      {/* Admin Warning */}
      {!isAdmin && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="text-yellow-800 font-medium">View Only Mode</p>
              <p className="text-yellow-700 text-sm mt-1">
                You can view settings but only admins can save changes.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Shift Definitions */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Shift Definitions</h3>
            <p className="text-sm text-gray-600 mt-1">
              Configure staffing requirements for each shift type.
            </p>
          </div>
          <button
            onClick={checkFeasibility}
            disabled={!isAdmin}
            className="flex-shrink-0 px-4 py-2 border border-purple-300 text-purple-700 bg-purple-50 rounded-md hover:bg-purple-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            📊 Check Feasibility
          </button>
        </div>

        <div className="p-6 space-y-6">
          {shiftTypes.map((shiftType) => {
            const shift = settings.shift_definitions[shiftType];
            const shiftEmoji = {
              morning: '🌅',
              day: '☀️',
              afternoon: '🌇',
              night: '🌙',
            }[shiftType] || '⏰';

            return (
              <div key={shiftType} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{shiftEmoji}</span>
                    <div>
                      <h4 className="font-semibold text-gray-900">
                        {getShiftDisplayName(shiftType)}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {formatTime(shift.start_hour, shift.start_minute)} - {formatTime(shift.end_hour, shift.end_minute)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Minimum Staff
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={shift.min_staff}
                      onChange={(e) => updateShiftDefinition(shiftType, 'min_staff', e.target.value)}
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Minimum required staff for this shift
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Maximum Staff
                    </label>
                    <input
                      type="number"
                      min={shift.min_staff}
                      max="10"
                      value={shift.max_staff}
                      onChange={(e) => updateShiftDefinition(shiftType, 'max_staff', e.target.value)}
                      disabled={!isAdmin}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Maximum allowed staff for this shift
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Save and Reset Buttons */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={resetToDefaults}
              disabled={!isAdmin || saving}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset to Defaults
            </button>

            <button
              onClick={saveSettings}
              disabled={!isAdmin || saving}
              className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Save Settings</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
      </CollapsibleSection>

      {/* Scheduling Constraints Section */}
      <CollapsibleSection
        id="scheduling-constraints"
        title="Scheduling Constraints"
        icon={AlertCircle}
        iconColor="text-blue-600"
        description="Configure hard and soft constraints for the scheduling algorithm."
        adminOnly={false}
      >
        <div>
        {/* Hard Constraints */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-red-600">
            🔴 Hard Constraints (Mandatory)
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            These constraints MUST be satisfied. If impossible, the schedule will fail to generate.
          </p>
          <div className="space-y-3 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Exactly 5 shifts per employee per week</p>
                <p className="text-sm text-gray-600">Each employee must work exactly 5 shifts in the scheduling week</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Minimum 12-hour rest between shifts</p>
                <p className="text-sm text-gray-600">Employees must have at least 12 hours between the end of one shift and the start of another</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Minimum 3 different shift types per employee</p>
                <p className="text-sm text-gray-600">Each employee must work at least 3 different shift types during the week (e.g., not all day shifts)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">At least 1 day shift per employee</p>
                <p className="text-sm text-gray-600">Every employee must work at least one day shift during the week</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Coverage requirements per shift</p>
                <p className="text-sm text-gray-600">Each shift must have minimum and maximum staff assigned as configured above</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">No overlapping shifts for same employee</p>
                <p className="text-sm text-gray-600">An employee cannot be assigned to two shifts that overlap in time</p>
              </div>
            </div>
          </div>
        </div>

        {/* 12-Hour Rest Rule Details */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-orange-600">
            ⚠️ 12-Hour Rest Rule - Incompatible Shift Combinations
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            These shift pairs violate the 12-hour rest requirement on consecutive days:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div>
              <p className="font-medium text-gray-900 mb-2">Day (10:00-19:00) → Next Day:</p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>❌ Morning (04:00) - only 9 hours gap</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-900 mb-2">Afternoon (15:00-00:00) → Next Day:</p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>❌ Morning (04:00) - only 4 hours gap</li>
                <li>❌ Day (10:00) - only 10 hours gap</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-900 mb-2">Night (19:00-04:00) → Next Day:</p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>❌ Morning (04:00) - 0 hours gap (CRITICAL)</li>
                <li>❌ Day (10:00) - only 6 hours gap</li>
                <li>❌ Afternoon (15:00) - only 11 hours gap</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-gray-900 mb-2">All others:</p>
              <ul className="text-sm text-gray-700 space-y-1 ml-4">
                <li>✅ Allowed (sufficient 12+ hour gap)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Soft Constraints */}
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-4 text-yellow-600">
            🟡 Soft Constraints (Optimization Preferences)
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            These constraints are preferences that the scheduler tries to satisfy, but may be relaxed if necessary to find a feasible schedule.
          </p>
          <div className="space-y-3 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Avoid 3+ day shifts per employee</p>
                <p className="text-sm text-gray-600">Penalizes employees working 3 or more day shifts in a week (Weight: 5)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Avoid 4-5 consecutive working days</p>
                <p className="text-sm text-gray-600">Discourages employees from working 4 or 5 consecutive days in a row (Weight: 4-6)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Night shift fatigue for previous week workers</p>
                <p className="text-sm text-gray-600">Minimizes night shifts for employees who worked 3+ nights last week (Weight: 5)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">High-traffic days staffing priority</p>
                <p className="text-sm text-gray-600">Prioritizes maximum staff on admin-selected high-traffic days (Weight: 3)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Weekend minimum staffing</p>
                <p className="text-sm text-gray-600">Prefers minimum staff on weekend days (Weight: 1)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Balance night shift distribution</p>
                <p className="text-sm text-gray-600">Minimizes variance in night shifts across employees (Weight: 3)</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-gray-900">Avoid bad recovery patterns</p>
                <p className="text-sm text-gray-600">Penalizes patterns like Night→Day Off→Morning or similar poor recovery sequences (Weight: 3)</p>
              </div>
            </div>
          </div>
        </div>
        </div>
      </CollapsibleSection>

      {/* Employee Management Section */}
      <CollapsibleSection
        id="employee-management"
        title="Employee Management"
        icon={Users}
        iconColor="text-green-600"
        description="View and manage employee information, add new team members, or remove employees from the system."
        adminOnly={false}
      >
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              {employees.length > 0 && (
                <button
                  onClick={handleExportEmployeesCSV}
                  disabled={loadingEmployees}
                  className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors disabled:opacity-50"
                >
                  <Download size={14} />
                  <span>Export CSV</span>
                </button>
              )}
              {isAdmin && (
                <label className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-md hover:bg-green-200 transition-colors cursor-pointer">
                  <Upload size={14} />
                  <span>Import CSV</span>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleImportEmployeesCSV}
                    disabled={loadingEmployees}
                    className="hidden"
                  />
                </label>
              )}
              <button
                onClick={loadEmployeeList}
                disabled={loadingEmployees}
                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={loadingEmployees ? 'animate-spin' : ''} size={14} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

        {loadingEmployees ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="animate-spin text-indigo-500" size={24} />
            <span className="ml-3 text-gray-600">Loading employees...</span>
          </div>
        ) : employees.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <AlertCircle className="mx-auto text-yellow-600 mb-2" size={32} />
            <p className="text-yellow-800 font-medium mb-1">No employees found</p>
            <p className="text-yellow-700 text-sm">
              Import employees using the CSV import feature in the Team Members section to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Employee Count Summary */}
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="bg-indigo-600 text-white rounded-full w-12 h-12 flex items-center justify-center font-bold text-lg">
                    {employees.length}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">Total Employees</p>
                    <p className="text-sm text-gray-600">Eligible for shift assignments</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Employee List Table */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {employees.map((emp, index) => (
                    <tr key={emp.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {emp.id}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {emp.name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {emp.email || <span className="text-gray-400 italic">No email</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Info Note */}
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Employee Management Tips:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>To add/remove employees, use the CSV import in the Team Members section</li>
                    <li>Only employees in this list will be assigned to shifts during schedule generation</li>
                    <li>Changes to employees take effect immediately across all features</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">How it works:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Min/Max staff determines how many people work each shift</li>
              <li>Use "Check Feasibility" before saving to validate settings</li>
              <li>Changes apply to the next schedule generation</li>
              <li>The scheduler will respect these constraints when assigning shifts</li>
              <li>Settings are saved to Firebase and persist across sessions</li>
            </ul>
          </div>
        </div>
      </div>
      </CollapsibleSection>

      {/* Employee Notes Section */}
      <CollapsibleSection
        id="employee-notes"
        title="Employee Schedule Notes"
        icon={FileText}
        iconColor="text-indigo-600"
        description="Add personal notes for each employee that will be displayed during schedule generation."
        adminOnly={true}
      >
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {employees.map(employee => (
              <div key={employee.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-medium text-gray-900">{employee.name}</h4>
                    <p className="text-xs text-gray-500">ID: {employee.id}</p>
                  </div>
                </div>
                <input
                  type="text"
                  value={employeeNotes[employee.id] || ''}
                  onChange={(e) => {
                    setEmployeeNotes(prev => ({
                      ...prev,
                      [employee.id]: e.target.value
                    }));
                  }}
                  placeholder="Add a note for this employee (e.g., 'Prefers morning shifts', 'Avoid Fridays')"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={savingAllNotes}
                />
              </div>
            ))}
          </div>

          {/* Single Save Button for All Notes with inline success message */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex-1">
              {notesSaveMessage && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="inline-flex items-center space-x-2 text-green-700"
                >
                  <CheckCircle className="text-green-600" size={16} />
                  <span className="text-sm font-medium">{notesSaveMessage}</span>
                </motion.div>
              )}
            </div>
            <button
              onClick={saveAllEmployeeNotes}
              disabled={savingAllNotes}
              className="flex items-center space-x-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingAllNotes ? (
                <>
                  <RefreshCw className="animate-spin" size={16} />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Save size={16} />
                  <span>Save All Notes</span>
                </>
              )}
            </button>
          </div>

          {/* Info Box */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mt-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-indigo-600 flex-shrink-0 mt-0.5" size={16} />
              <div className="text-sm text-indigo-800">
                <p className="font-medium mb-1">Notes appear in schedule generation:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Notes are shown above the "Select Break" section for each employee</li>
                  <li>Use notes to remind yourself of preferences or constraints</li>
                  <li>Click "Save All Notes" to save changes for all employees</li>
                  <li>Notes are only visible to admins</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Daily Slack Notifications Section */}
      <CollapsibleSection
        id="daily-slack-notifications"
        title="Daily Shift Notifications"
        icon={Send}
        iconColor="text-blue-600"
        description="Automatically send daily shift schedules to admins via Slack direct messages at a specific time."
        adminOnly={true}
      >
        <div>

          {slackSettingsMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <CheckCircle className="text-green-600" size={16} />
                <span className="text-green-800 text-sm">{slackSettingsMessage}</span>
              </div>
            </motion.div>
          )}

          {slackSettingsError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4"
            >
              <div className="flex items-center space-x-2">
                <AlertCircle className="text-red-600" size={16} />
                <span className="text-red-800 text-sm">{slackSettingsError}</span>
              </div>
            </motion.div>
          )}

          {loadingSlackSettings ? (
            <div className="text-center py-8 text-gray-500">Loading notification settings...</div>
          ) : (
            <>
              {/* Enable/Disable Toggle */}
              <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={slackNotificationSettings.enabled}
                        onChange={(e) => setSlackNotificationSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-300 rounded-full peer peer-checked:bg-blue-600 peer-focus:ring-2 peer-focus:ring-blue-300 transition-colors"></div>
                      <div className="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5"></div>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Enable Daily Notifications</p>
                      <p className="text-sm text-gray-600">Send shift schedules to admins automatically</p>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${slackNotificationSettings.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                    {slackNotificationSettings.enabled ? 'Active' : 'Inactive'}
                  </span>
                </label>
              </div>

              {/* Notification Time */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Clock className="inline mr-2" size={16} />
                  Notification Time (Tbilisi, Georgia)
                </label>
                <div className="w-full max-w-xs px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg">
                  <span className="text-lg font-semibold text-gray-900">9:00 AM</span>
                  <span className="text-sm text-gray-500 ml-2">(Fixed)</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Notifications are automatically sent every day at 9:00 AM Asia/Tbilisi time
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  ℹ️ The notification time is configured in Google Cloud Scheduler and cannot be changed from this UI
                </p>
              </div>

              {/* Weekend Notifications Toggle */}
              <div className="mb-6">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slackNotificationSettings.notifyOnWeekends}
                    onChange={(e) => setSlackNotificationSettings(prev => ({ ...prev, notifyOnWeekends: e.target.checked }))}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <div>
                    <p className="font-medium text-gray-900">Send Notifications on Weekends</p>
                    <p className="text-sm text-gray-600">Include Saturday and Sunday in daily notifications</p>
                  </div>
                </label>
              </div>

              {/* Admin-Employee Assignments */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">
                  Admin Responsibilities (for reference only)
                </h4>
                <p className="text-xs text-gray-500 mb-3">
                  Assign employees to admins for organizational purposes. This does not affect the notification content yet.
                </p>
                <div className="space-y-4">
                  {adminEmails.map((adminEmail) => {
                    const adminAssignment = slackNotificationSettings.adminAssignments.find(a => a.email === adminEmail);
                    const assignedEmployees = adminAssignment?.employees || [];
                    
                    return (
                      <div key={adminEmail} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                        <div className="flex items-center space-x-2 mb-3">
                          <Mail className="text-gray-500" size={16} />
                          <span className="font-medium text-gray-900">{adminEmail}</span>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                          {employees.map((emp) => {
                            const isSelected = assignedEmployees.includes(emp.id);
                            return (
                              <label key={emp.id} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    setSlackNotificationSettings(prev => {
                                      const assignments = [...prev.adminAssignments];
                                      const index = assignments.findIndex(a => a.email === adminEmail);
                                      
                                      if (index >= 0) {
                                        // Update existing assignment
                                        let employees = [...assignments[index].employees];
                                        if (e.target.checked) {
                                          employees.push(emp.id);
                                        } else {
                                          employees = employees.filter(id => id !== emp.id);
                                        }
                                        assignments[index] = { email: adminEmail, employees };
                                      } else {
                                        // Create new assignment
                                        assignments.push({ email: adminEmail, employees: [emp.id] });
                                      }
                                      
                                      return { ...prev, adminAssignments: assignments };
                                    });
                                  }}
                                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{emp.name}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">
                          {assignedEmployees.length} employee(s) assigned
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-3">
                <button
                  onClick={saveSlackNotificationSettings}
                  disabled={savingSlackSettings}
                  className="flex items-center space-x-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {savingSlackSettings ? (
                    <>
                      <RefreshCw className="animate-spin" size={16} />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      <span>Save Settings</span>
                    </>
                  )}
                </button>
                
                <button
                  onClick={testDailySlackNotification}
                  disabled={testingDailyNotification}
                  className="flex items-center space-x-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testingDailyNotification ? (
                    <>
                      <RefreshCw className="animate-spin" size={16} />
                      <span>Sending...</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Send Test Notification</span>
                    </>
                  )}
                </button>
              </div>

              {/* Info Box */}
              <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">How daily notifications work:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Runs automatically via Google Cloud Scheduler at the configured time</li>
                      <li>Sends a direct message to each admin with the day's shift schedule</li>
                      <li>Includes all shifts and employees on leave with timeframe details</li>
                      <li>Can be disabled anytime by toggling the enable switch</li>
                      <li>Use the test button to preview the message before going live</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </CollapsibleSection>

      {/* Slack Test Section */}
      <CollapsibleSection
        id="slack-test"
        title="Slack Integration Test"
        icon={Send}
        iconColor="text-green-600"
        description="Test your Slack bot connection by sending a test message to verify the integration is working."
        adminOnly={true}
      >
        <div>
          {slackTestMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-green-800 text-sm">
              {slackTestMessage}
            </div>
          )}
          {slackTestError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-800 text-sm">
              {slackTestError}
            </div>
          )}

          <button
            onClick={async () => {
              setSlackTesting(true);
              setSlackTestMessage(null);
              setSlackTestError(null);
              try {
                await notifySlack({
                  request_id: 'test-123',
                  target_email: 'kordzadze2002@gmail.com',
                  requester_name: 'Test Requester',
                  original_shift: { date: '2026-04-21', type: 'morning', time: '04:00 - 13:00' },
                  target_shift: { date: '2026-04-22', type: 'night', time: '19:00 - 04:00' }
                }, getIdToken);
                setSlackTestMessage('✅ Test message sent to kordzadze2002@gmail.com — check Slack!');
              } catch (err) {
                setSlackTestError(`❌ Failed: ${err.message}`);
              } finally {
                setSlackTesting(false);
              }
            }}
            disabled={slackTesting}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <span>{slackTesting ? 'Sending...' : '💬 Send Test Slack Message'}</span>
          </button>
        </div>
      </CollapsibleSection>
    </div>
  );
}

// Helper functions
function getDefaultSettings() {
  return {
    shift_definitions: {
      morning: { label: 'Morning', start_hour: 4, start_minute: 0, end_hour: 13, end_minute: 0, min_staff: 1, max_staff: 1 },
      day: { label: 'Day', start_hour: 10, start_minute: 0, end_hour: 19, end_minute: 0, min_staff: 1, max_staff: 3 },
      afternoon: { label: 'Afternoon', start_hour: 15, start_minute: 0, end_hour: 0, end_minute: 0, min_staff: 1, max_staff: 5 },
      night: { label: 'Night', start_hour: 19, start_minute: 0, end_hour: 4, end_minute: 0, min_staff: 1, max_staff: 5 },
    },
    shift_combinations: {
      1: { morning: 1, day: 1, night: 3, afternoon: 0, description: 'Morning + Heavy Night' },
      2: { morning: 0, day: 0, night: 2, afternoon: 3, description: 'Afternoon-Heavy' },
      3: { morning: 1, day: 1, night: 2, afternoon: 1, description: 'Morning + Balanced' },
      4: { morning: 0, day: 1, night: 2, afternoon: 2, description: 'Balanced' },
      5: { morning: 0, day: 0, night: 2, afternoon: 3, description: 'Afternoon-Heavy (alt)' },
    },
  };
}

function formatTime(hour, minute) {
  const h = hour.toString().padStart(2, '0');
  const m = minute.toString().padStart(2, '0');
  return `${h}:${m}`;
}
