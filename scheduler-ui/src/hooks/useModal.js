/**
 * useModal Hook
 * Provides easy-to-use alert() and confirm() replacements
 * Returns promise-based modals that replace window.alert/confirm
 */

import { useState, useCallback } from 'react';

export default function useModal() {
  const [alertState, setAlertState] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info',
  });

  const [confirmState, setConfirmState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    type: 'warning',
    resolver: null,
  });

  /**
   * Show alert modal (replaces window.alert)
   * @param {string} message - Alert message
   * @param {string} title - Alert title
   * @param {string} type - Alert type: 'info', 'success', 'warning', 'error'
   * @returns {Promise<void>}
   */
  const alert = useCallback((message, title = 'Notice', type = 'info') => {
    return new Promise((resolve) => {
      setAlertState({
        isOpen: true,
        title,
        message,
        type,
        onClose: () => {
          setAlertState(prev => ({ ...prev, isOpen: false }));
          resolve();
        },
      });
    });
  }, []);

  /**
   * Show confirm modal (replaces window.confirm)
   * @param {string} message - Confirmation message
   * @param {string} title - Confirmation title
   * @param {object} options - Additional options
   * @returns {Promise<boolean>} - True if confirmed, false if cancelled
   */
  const confirm = useCallback((message, title = 'Confirm', options = {}) => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        title,
        message,
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        type: options.type || 'warning',
        onConfirm: () => {
          setConfirmState(prev => ({ ...prev, isOpen: false }));
          resolve(true);
        },
        onCancel: () => {
          setConfirmState(prev => ({ ...prev, isOpen: false }));
          resolve(false);
        },
      });
    });
  }, []);

  return {
    alert,
    confirm,
    alertState,
    confirmState,
    closeAlert: () => setAlertState(prev => ({ ...prev, isOpen: false })),
    closeConfirm: () => setConfirmState(prev => ({ ...prev, isOpen: false })),
  };
}
