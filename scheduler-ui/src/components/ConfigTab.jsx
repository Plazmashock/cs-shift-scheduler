import React, { useState, useEffect } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Lock, Unlock } from 'lucide-react';
import { loadConfig, saveConfig, rollbackConfig, getConfigHistory, validateConfig, validateConfigWithAssumed } from '../services/firebaseConfig';
import { useAuth } from '../contexts/AuthContext';

export default function ConfigTab() {
  const { user, isAdmin: authIsAdmin, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Config state
  const [config, setConfig] = useState({
    staffRequirements: {
      morning: { min: 1, max: 1 },
      day: { min: 2, max: 4 },
      afternoon: { min: 2, max: 4 },
      night: { min: 2, max: 5 }
    },
    patterns: ['A', 'B', 'C', 'D'],
    patternDefinitions: {
      A: { morning: 1, day: 1, afternoon: 1, night: 2 },
      B: { morning: 0, day: 1, afternoon: 2, night: 2 },
      C: { morning: 1, day: 1, afternoon: 2, night: 1 },
      D: { morning: 0, day: 1, afternoon: 2, night: 2 }
    },
    flexEmployeeCount: 0,
    employees: []
  });

  const [editingConfig, setEditingConfig] = useState(config);
  const [showPreview, setShowPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [assumedEmployees, setAssumedEmployees] = useState(0);
  const [feasibilityDiag, setFeasibilityDiag] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState({ open: false, pattern: null });
  // Add employee modal state
  const [addEmployeeModalOpen, setAddEmployeeModalOpen] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [newEmpStatus, setNewEmpStatus] = useState('agent');

  // Note: admin detection is automatic for users with @example.com via AuthContext

  // Load config on mount
  useEffect(() => {
    loadConfigFromFirebase();
    // Set admin state from auth context
    setIsAdmin(Boolean(authIsAdmin));
  }, []);

  // Keep auth changes in sync
  useEffect(() => {
    setIsAdmin(Boolean(authIsAdmin));
  }, [authIsAdmin]);

  const loadConfigFromFirebase = async () => {
    try {
      setLoading(true);
      const data = await loadConfig();
      if (data) {
        setConfig(data);
        setEditingConfig(data);
      }
      const hist = await getConfigHistory();
      if (hist) setHistory(hist);
    } catch (error) {
      setSaveError('Failed to load config: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    // The real sign-out is handled by AuthProvider; here we clear local admin mode
    setIsAdmin(false);
  };

  const handleStaffRequirementChange = (shiftType, field, value) => {
    setEditingConfig(prev => ({
      ...prev,
      staffRequirements: {
        ...prev.staffRequirements,
        [shiftType]: {
          ...prev.staffRequirements[shiftType],
          [field]: parseInt(value) || 0
        }
      }
    }));
    setSaveSuccess(false);
    setSaveError('');
  };

  const handlePatternToggle = (pattern) => {
    setEditingConfig(prev => ({
      ...prev,
      patterns: prev.patterns.includes(pattern)
        ? prev.patterns.filter(p => p !== pattern)
        : [...prev.patterns, pattern]
    }));
    setSaveSuccess(false);
    setSaveError('');
  };

  const handlePatternTextChange = (pattern, value) => {
    setEditingConfig(prev => ({
      ...prev,
      patternDefinitions: {
        ...(prev.patternDefinitions || {}),
        [pattern]: value
      }
    }));
    setSaveSuccess(false);
    setSaveError('');
  };

  const handleFlexCountChange = (value) => {
    setEditingConfig(prev => ({
      ...prev,
      flexEmployeeCount: Math.max(0, parseInt(value) || 0)
    }));
    setSaveSuccess(false);
    setSaveError('');
  };

  const validateConfig = (cfg) => {
    // Validate staff requirements
    for (const [shift, req] of Object.entries(cfg.staffRequirements)) {
      if (req.min < 0 || req.max < 0) {
        return `${shift}: min and max must be >= 0`;
      }
      if (req.min > req.max) {
        return `${shift}: min cannot exceed max`;
      }
      if (req.max === 0) {
        return `${shift}: max must be > 0 to require coverage`;
      }
    }
    
    // Validate patterns
    if (cfg.patterns.length === 0) {
      return 'At least one pattern must be selected';
    }

    // Validate flex count
    if (cfg.flexEmployeeCount < 0) {
      return 'Flex employee count must be >= 0';
    }

    return null;
  };

  const runFeasibilityCheck = async (cfg, assumed) => {
    try {
      setPreviewError('');
      const resp = await validateConfigWithAssumed(cfg, assumed);
      if (!resp) {
        setPreviewError('Validation service returned no response');
        setFeasibilityDiag(null);
        return null;
      }

      // If backend unreachable, validateConfigWithAssumed now returns structured diagnostic with issues
      if (resp.diagnostic) {
        setFeasibilityDiag(resp.diagnostic);
      } else if (resp.summary) {
        setFeasibilityDiag(resp.summary);
      } else {
        setFeasibilityDiag(resp);
      }

      // If there are errors but no diagnostic, show them as previewError
      if (!resp.valid && resp.errors) {
        setPreviewError((resp.errors || []).join(', '));
      }

      return resp;
    } catch (err) {
      setPreviewError('Feasibility check failed: ' + err.message);
      setFeasibilityDiag({ feasible: false, issues: [{ reason: err.message }] });
      return null;
    }
  };

  const handlePreview = async () => {
    setPreviewError('');
    
    const validationError = validateConfig(editingConfig);
    if (validationError) {
      setPreviewError(validationError);
      return;
    }

    try {
      // Call validation helper (backend)
      const result = await validateConfig(editingConfig);
      if (!result || !result.valid) {
        setPreviewError((result && result.errors && result.errors.join(', ')) || 'Validation failed');
        return;
      }

      // Also run feasibility check if user provided assumedEmployees
      if (assumedEmployees && Number(assumedEmployees) > 0) {
        await runFeasibilityCheck(editingConfig, Number(assumedEmployees));
      }

      setShowPreview(true);
    } catch (error) {
      setPreviewError('Failed to validate config: ' + error.message);
    }
  };

  const handleSave = async () => {
    setSaveError('');
    setSaveSuccess(false);

    const validationError = validateConfig(editingConfig);
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    try {
      // Save to backend/Firebase. Use authenticated user's email if available.
      const adminEmailToSend = user?.email || 'unknown@example.com';
      await saveConfig(editingConfig, {
        timestamp: new Date().toISOString(),
        adminEmail: adminEmailToSend
      });

      // Update current config
      setConfig(editingConfig);
      setSaveSuccess(true);
      setShowPreview(false);
      
      // Reload history
      const hist = await getConfigHistory();
      if (hist) setHistory(hist);

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setSaveError('Failed to save config: ' + error.message);
    }
  };

  const handleRollback = async (timestamp) => {
    try {
      const prevConfig = history.find(h => h.timestamp === timestamp);
      if (!prevConfig) {
        setSaveError('Could not find historical config');
        return;
      }

      const adminEmailToSend = user?.email || 'unknown@example.com';
      await rollbackConfig(prevConfig.config, timestamp, { adminEmail: adminEmailToSend });
      setConfig(prevConfig.config);
      setEditingConfig(prevConfig.config);
      setSaveSuccess(true);

      // Reload history
      const hist = await getConfigHistory();
      if (hist) setHistory(hist);

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setSaveError('Rollback failed: ' + error.message);
    }
  };

  const discardChanges = () => {
    setEditingConfig(config);
    setSaveSuccess(false);
    setSaveError('');
    setShowPreview(false);
    setPreviewError('');
  };

  const handlePopulateEmployees = async () => {
    try {
      setSaveError('');
      setSaveSuccess(false);
      
      const response = await fetch('/api/employees/populate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to populate employees: ${response.statusText}`);
      }
      
      const data = await response.json();
      setSaveSuccess(true);
      
      // Reload config which will now include the employees
      setTimeout(() => {
        loadConfigFromFirebase();
      }, 1000);
    } catch (error) {
      setSaveError('Failed to populate employees: ' + error.message);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Checking authentication...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 max-w-md w-full text-center">
          <div className="flex items-center justify-center mb-4">
            <Lock className="w-12 h-12 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2 dark:text-white">Access Restricted</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">You must sign in with an @example.com account to access configuration.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">Use the Sign In button in the app header to authenticate.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Unlock className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Configuration</h1>
          <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-xs font-semibold">
            Admin Mode
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm"
        >
          Logout
        </button>
      </div>

      {/* Status Messages */}
      {saveSuccess && (
        <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/50 rounded-lg flex items-center gap-3">
          <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
          <span className="text-green-800 dark:text-green-200 font-semibold">Configuration saved successfully!</span>
        </div>
      )}

      {saveError && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <span className="text-red-800 dark:text-red-200">{saveError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Config Form */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-none border dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6">Shift Staff Requirements</h2>

            {/* Morning */}
            <div className="mb-6 pb-6 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">Morning (04:00 - 13:00)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Minimum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.morning.min}
                    onChange={(e) => handleStaffRequirementChange('morning', 'min', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Maximum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.morning.max}
                    onChange={(e) => handleStaffRequirementChange('morning', 'max', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>
            </div>

            {/* Day */}
            <div className="mb-6 pb-6 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">Day (10:00 - 19:00)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Minimum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.day.min}
                    onChange={(e) => handleStaffRequirementChange('day', 'min', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Maximum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.day.max}
                    onChange={(e) => handleStaffRequirementChange('day', 'max', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>
            </div>

            {/* Afternoon */}
            <div className="mb-6 pb-6 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">Afternoon (15:00 - 00:00)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Minimum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.afternoon.min}
                    onChange={(e) => handleStaffRequirementChange('afternoon', 'min', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Maximum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.afternoon.max}
                    onChange={(e) => handleStaffRequirementChange('afternoon', 'max', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>
            </div>

            {/* Night */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">Night (19:00 - 04:00)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Minimum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.night.min}
                    onChange={(e) => handleStaffRequirementChange('night', 'min', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Maximum Staff</label>
                  <input
                    type="number"
                    min="0"
                    value={editingConfig.staffRequirements.night.max}
                    onChange={(e) => handleStaffRequirementChange('night', 'max', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Pattern Types */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-none border dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6">Employee Patterns</h2>
            <div className="flex gap-4 flex-wrap">
              {editingConfig.patterns.map(pattern => (
                <div key={pattern} className="flex items-center gap-2">
                  <button
                    onClick={() => handlePatternToggle(pattern)}
                    className={`px-4 py-2 rounded-md font-medium text-sm border ${editingConfig.patterns.includes(pattern) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600'}`}
                  >
                    Pattern {pattern}
                  </button>
                  {/* note: remove button moved into the pattern definition card below; keep tokens minimal */}
                </div>
              ))}

              {/* Add pattern button: always visible, disabled when max patterns reached */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // find next available single uppercase letter
                    const used = new Set(editingConfig.patterns);
                    let next = null;
                    for (let i = 0; i < 26; i++) {
                      const letter = String.fromCharCode(65 + i);
                      if (!used.has(letter)) { next = letter; break; }
                    }
                    if (!next) return;
                    setEditingConfig(prev => ({
                      ...prev,
                      patterns: [...prev.patterns, next],
                      patternDefinitions: {
                        ...(prev.patternDefinitions || {}),
                        [next]: { morning: 0, day: 1, afternoon: 2, night: 2 }
                      }
                    }));
                  }}
                  className={`px-4 py-2 rounded-md font-medium text-sm border bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/50`}
                >
                  Add Pattern
                </button>
              </div>
            </div>
            <div className="mt-3">
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Or edit comma-separated patterns</label>
              <input
                type="text"
                value={editingConfig.patterns.join(', ')}
                onChange={(e) => {
                  const text = e.target.value;
                  const parts = text.split(',').map(p => p.trim().toUpperCase()).filter(Boolean);
                  const valid = parts.filter(p => ['A', 'B', 'C', 'D'].includes(p));
                  const uniq = Array.from(new Set(valid));
                  setEditingConfig(prev => ({ ...prev, patterns: uniq }));
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-600"
                placeholder="A, B, C"
              />
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">Selected: {editingConfig.patterns.join(', ')}</p>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Assumed number of employees (for feasibility check)</label>
              <div className="flex items-center gap-3">
                <input type="number" min="0" value={assumedEmployees} onChange={(e) => setAssumedEmployees(parseInt(e.target.value || '0'))} className="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
                <button onClick={() => runFeasibilityCheck(editingConfig, Number(assumedEmployees))} className="px-3 py-2 bg-indigo-600 text-white rounded">Run feasibility</button>
              </div>
              {feasibilityDiag && (
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/50 rounded text-sm">
                  <div className="text-yellow-900 dark:text-yellow-100"><strong>Feasibility:</strong> {feasibilityDiag.feasible ? 'Likely feasible' : 'Infeasible'}</div>
                  <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                    <div><strong>Total weekly required slots:</strong> {feasibilityDiag.total_staff_slots_needed || feasibilityDiag.total_slots_per_week}</div>
                    <div><strong>Estimated min employees:</strong> {feasibilityDiag.estimated_min_employees}</div>
                    <div><strong>Assumed employees:</strong> {feasibilityDiag.assumed_employees}</div>
                  </div>
                  {feasibilityDiag.issues && feasibilityDiag.issues.length > 0 && (
                    <div className="mt-2 text-xs text-red-700 dark:text-red-300">
                      <strong>Issues:</strong>
                      <ul className="list-disc list-inside">
                        {feasibilityDiag.issues.map((it, idx) => (
                          <li key={idx}>{it.reason || it}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            
              {/* Pattern Definitions Editor (structured counts) */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold mb-2 text-gray-800 dark:text-white">Pattern Definitions (edit exact counts)</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Each pattern must total 5 shifts. Edit numeric counts for each shift type.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {['A','B','C','D'].map(pat => {
                    const def = (editingConfig.patternDefinitions && editingConfig.patternDefinitions[pat]) || {morning:0,day:0,afternoon:0,night:0};
                    const active = editingConfig.patterns.includes(pat);
                    return (
                      <div key={pat} className="p-3 border border-gray-200 dark:border-gray-700 rounded relative">
                        <div className="mb-2">
                          <div className="font-semibold text-gray-800 dark:text-white">Pattern {pat}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">Selected: {active ? 'active' : 'inactive'}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400">Morning</label>
                            <input disabled={!active} type="number" min="0" value={def.morning} onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setEditingConfig(prev => ({
                                ...prev,
                                patternDefinitions: {
                                  ...(prev.patternDefinitions || {}),
                                  [pat]: { ...(prev.patternDefinitions?.[pat] || {}), morning: v }
                                }
                              }));
                            }} className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400">Day</label>
                            <input disabled={!active} type="number" min="0" value={def.day} onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setEditingConfig(prev => ({
                                ...prev,
                                patternDefinitions: {
                                  ...(prev.patternDefinitions || {}),
                                  [pat]: { ...(prev.patternDefinitions?.[pat] || {}), day: v }
                                }
                              }));
                            }} className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400">Afternoon</label>
                            <input disabled={!active} type="number" min="0" value={def.afternoon} onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setEditingConfig(prev => ({
                                ...prev,
                                patternDefinitions: {
                                  ...(prev.patternDefinitions || {}),
                                  [pat]: { ...(prev.patternDefinitions?.[pat] || {}), afternoon: v }
                                }
                              }));
                            }} className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-400">Night</label>
                            <input disabled={!active} type="number" min="0" value={def.night} onChange={(e) => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setEditingConfig(prev => ({
                                ...prev,
                                patternDefinitions: {
                                  ...(prev.patternDefinitions || {}),
                                  [pat]: { ...(prev.patternDefinitions?.[pat] || {}), night: v }
                                }
                              }));
                            }} className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">Total: {(def.morning||0)+(def.day||0)+(def.afternoon||0)+(def.night||0)}</div>
                        <div className="absolute top-2 right-2 flex items-center gap-2">
                          <button
                            onClick={() => {
                              // toggle active state without deleting definition
                              setEditingConfig(prev => {
                                const has = (prev.patterns || []).includes(pat);
                                return {
                                  ...prev,
                                  patterns: has ? prev.patterns.filter(p => p !== pat) : [...(prev.patterns||[]), pat]
                                };
                              });
                            }}
                            className={`px-2 py-1 text-xs rounded ${active ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                            title={active ? 'Disable pattern' : 'Enable pattern'}
                          >
                            {active ? 'Disable' : 'Enable'}
                          </button>
                          <button
                            onClick={() => setConfirmRemove({ open: true, pattern: pat })}
                            title={`Remove pattern ${pat}`}
                            className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-xs"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          </div>

          {/* Flex Employee Count */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-none border dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6">Flex Employees</h2>
            <div className="max-w-xs">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Number of Flex Employees</label>
              <input
                type="number"
                min="0"
                max="10"
                value={editingConfig.flexEmployeeCount}
                onChange={(e) => handleFlexCountChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Flex employees work variable shifts beyond standard patterns</p>
            </div>
          </div>

          {/* Employees Management */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-none border dark:border-gray-700 p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-4">Employee Roster</h2>
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
              {(editingConfig.employees || []).length > 0 ? (
                editingConfig.employees.map((emp, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{emp.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">ID: {emp.id}</div>
                    </div>
                    <button
                      onClick={() => {
                        setEditingConfig(prev => ({
                          ...prev,
                          employees: prev.employees.filter((_, i) => i !== idx)
                        }));
                      }}
                      className="ml-3 px-3 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 rounded transition"
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">No employees configured</p>
              )}
            </div>

            {/* Populate Employees Button */}
            <button
              onClick={handlePopulateEmployees}
              className="w-full px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 transition mb-4"
            >
              Populate Employees from System
            </button>

            {/* Add Employee */}
            <div className="flex gap-2">
              <input
                type="text"
                id="newEmployeeName"
                placeholder="Employee name"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              <button
                onClick={() => {
                  const nameInput = document.getElementById('newEmployeeName');
                  const name = nameInput?.value?.trim();
                  if (!name) {
                    alert('Please enter an employee name');
                    return;
                  }
                  const nextId = (editingConfig.employees || []).length > 0
                    ? Math.max(...editingConfig.employees.map(e => typeof e.id === 'number' ? e.id : parseInt(e.id, 10) || 0)) + 1
                    : 1;
                  setEditingConfig(prev => ({
                    ...prev,
                    employees: [...(prev.employees || []), { id: nextId, name }]
                  }));
                  nameInput.value = '';
                }}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition"
              >
                Add Employee
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Manage the roster of employees available for scheduling</p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mb-6">
            <button
              onClick={handlePreview}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              Preview Changes
            </button>
            <button
              onClick={handleSave}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition"
            >
              Save Configuration
            </button>
            <button
              onClick={discardChanges}
              className="flex-1 px-6 py-3 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition"
            >
              Discard
            </button>
          </div>

          {/* Preview Error */}
          {previewError && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg flex items-center gap-3 mb-6">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              <span className="text-red-800 dark:text-red-200">{previewError}</span>
            </div>
          )}

          {/* Preview Section */}
          {showPreview && !previewError && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/50 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-4">Preview: New Configuration</h3>
              <div className="space-y-4 text-sm text-blue-800 dark:text-blue-200">
                <div>
                  <strong>Staff Requirements:</strong>
                  <ul className="list-disc list-inside mt-2">
                    {Object.entries(editingConfig.staffRequirements).map(([shift, req]) => (
                      <li key={shift}>
                        {shift.charAt(0).toUpperCase() + shift.slice(1)}: {req.min}-{req.max} staff
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Patterns:</strong> {editingConfig.patterns.join(', ')}
                  <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                    {Object.entries(editingConfig.patternDefinitions || {}).map(([k, v]) => (
                      <div key={k}>
                        <strong>{k}:</strong> {`${v.morning || 0} morning, ${v.day || 0} day, ${v.afternoon || 0} afternoon, ${v.night || 0} night`}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <strong>Flex Employees:</strong> {editingConfig.flexEmployeeCount}
                </div>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-300 mt-4">Click "Save Configuration" to apply these changes</p>
            </div>
          )}
        </div>

        {/* Sidebar: History */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-none border dark:border-gray-700 p-6 h-fit">
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center justify-between cursor-pointer" onClick={() => setShowHistory(!showHistory)}>
            Configuration History
            {showHistory ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </h2>

          {showHistory && (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {history && history.length > 0 ? (
                history.map((entry, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 text-xs">
                    <div className="font-semibold text-gray-700 dark:text-gray-300">
                      {new Date(entry.timestamp).toLocaleString()}
                    </div>
                    <div className="text-gray-600 dark:text-gray-400 mt-1">By: {entry.admin || 'Unknown'}</div>
                    <button
                      onClick={() => handleRollback(entry.timestamp)}
                      className="mt-2 w-full px-2 py-1 bg-amber-500 text-white text-xs rounded hover:bg-amber-600 transition"
                    >
                      Rollback to this version
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-sm">No history available</p>
              )}
            </div>
          )}

          {/* Current Config Summary */}
          <div className="mt-6 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-900/50">
            <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-3">Active Configuration</h3>
            <div className="text-xs text-indigo-800 dark:text-indigo-200 space-y-2">
              <div><strong>Morning:</strong> {config.staffRequirements.morning.min}-{config.staffRequirements.morning.max}</div>
              <div><strong>Day:</strong> {config.staffRequirements.day.min}-{config.staffRequirements.day.max}</div>
              <div><strong>Afternoon:</strong> {config.staffRequirements.afternoon.min}-{config.staffRequirements.afternoon.max}</div>
              <div><strong>Night:</strong> {config.staffRequirements.night.min}-{config.staffRequirements.night.max}</div>
              <div><strong>Patterns:</strong> {config.patterns.join(', ')}</div>
              <div className="mt-2 text-xs text-indigo-800 dark:text-indigo-200">
                {Object.entries(config.patternDefinitions || {}).map(([k, v]) => (
                  <div key={k}><strong>{k}:</strong> {`${v.morning || 0} morning, ${v.day || 0} day, ${v.afternoon || 0} afternoon, ${v.night || 0} night`}</div>
                ))}
              </div>
              <div><strong>Flex:</strong> {config.flexEmployeeCount}</div>
            </div>
          </div>
          {/* Employee Roster in Sidebar */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Employee Roster</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-3">
              {(editingConfig.employees || []).length > 0 ? (
                (editingConfig.employees || []).map((emp, idx) => (
                  <div key={emp.id ?? idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{emp.name} {emp.status === 'admin' ? <span className="text-xs text-indigo-600 dark:text-indigo-400">(admin)</span> : null}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{emp.email || `ID: ${emp.id}`}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setEditingConfig(prev => ({ ...prev, employees: prev.employees.filter((_, i) => i !== idx) }));
                        }}
                        className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 dark:text-gray-400 italic">No employees configured</div>
              )}
            </div>
            <div className="mt-3 flex">
              <button onClick={() => setAddEmployeeModalOpen(true)} className="px-3 py-2 bg-green-600 text-white rounded text-sm">Add Employee</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Admins are marked and will be excluded from automatic scheduling.</p>
          </div>
        </div>
      </div>
      {/* Confirm Remove Modal */}
      {confirmRemove.open && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Confirm remove pattern {confirmRemove.pattern}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Removing this pattern will delete its definition. Are you sure you want to continue?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmRemove({ open: false, pattern: null })}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 dark:text-white rounded-md text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const pattern = confirmRemove.pattern;
                  setEditingConfig(prev => {
                    const newPatterns = prev.patterns.filter(p => p !== pattern);
                    const newDefs = { ...(prev.patternDefinitions || {}) };
                    delete newDefs[pattern];
                    return { ...prev, patterns: newPatterns, patternDefinitions: newDefs };
                  });
                  setConfirmRemove({ open: false, pattern: null });
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Add Employee Modal */}
      {addEmployeeModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4 dark:text-white">Add Employee</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Name</label>
                <input value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Email</label>
                <input value={newEmpEmail} onChange={(e) => setNewEmpEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded" />
              </div>
              <div>
                <label className="text-sm text-gray-600 dark:text-gray-400">Status</label>
                <select value={newEmpStatus} onChange={(e) => setNewEmpStatus(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded">
                  <option value="agent">Agent</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setAddEmployeeModalOpen(false)} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 dark:text-white rounded">Cancel</button>
              <button onClick={() => {
                const name = newEmpName && newEmpName.trim();
                if (!name) { alert('Please enter a name'); return; }
                // compute next id
                const nextId = (editingConfig.employees || []).length > 0
                  ? Math.max(...editingConfig.employees.map(e => typeof e.id === 'number' ? e.id : parseInt(e.id, 10) || 0)) + 1
                  : 1;
                const newEmployee = { id: nextId, name, email: newEmpEmail || '', status: newEmpStatus || 'agent' };
                setEditingConfig(prev => ({ ...prev, employees: [...(prev.employees || []), newEmployee] }));
                setNewEmpName(''); setNewEmpEmail(''); setNewEmpStatus('agent'); setAddEmployeeModalOpen(false);
              }} className="px-4 py-2 bg-green-600 text-white rounded">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
