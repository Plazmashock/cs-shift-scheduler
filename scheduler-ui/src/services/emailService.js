/**
 * Email Service - Sends emails directly via EmailJS
 * Uses EmailJS library to send emails with specified templates
 */

import emailjs from '@emailjs/browser';
import { EMAILJS_CONFIG } from '../config/emailjs.config';

// Initialize EmailJS (do this once on app startup)
export function initEmailJS() {
  try {
    emailjs.init(EMAILJS_CONFIG.PUBLIC_KEY);
    console.log('✅ EmailJS initialized with public key');
  } catch (err) {
    console.error('Failed to initialize EmailJS:', err);
  }
}

/**
 * Send email via Template 1 (All notifications)
 */
export async function sendSwapRequestEmail(data) {
  try {
    console.log('📧 [EMAIL] Sending notification via Template 1:', data);
    
    const result = await emailjs.send(
      EMAILJS_CONFIG.SERVICE_ID,
      EMAILJS_CONFIG.TEMPLATE_IDS.SWAP_REQUEST_APPROVAL,
      {
        email: data.email,
        isRequest: data.isRequest || false,
        isApproved: data.isApproved || false,
        isReadyForReview: data.isReadyForReview || false,
        isFinalized: data.isFinalized || false,
        isRejected: data.isRejected || false,
        requesterName: data.requesterName || '',
        targetEmployeeName: data.targetEmployeeName || '',
        employeeName: data.employeeName || '',
        originalDate: data.originalDate || '',
        originalShiftType: data.originalShiftType || '',
        originalTime: data.originalTime || '',
        targetDate: data.targetDate || '',
        targetShiftType: data.targetShiftType || '',
        targetTime: data.targetTime || '',
        newDate: data.newDate || '',
        newShiftType: data.newShiftType || '',
        newTime: data.newTime || '',
        reason: data.reason || ''
      }
    );
    
    console.log('✅ Email sent successfully:', result);
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to send email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send email via Template 1 (All notifications) - Alias for backwards compatibility
 */
export async function sendSwapReadyForReviewEmail(data) {
  return sendSwapRequestEmail(data);
}

/**
 * Legacy function names for backwards compatibility
 */
export async function sendSwapRequestNotification(requesterName, targetEmployeeName, targetEmployeeEmail, originalShiftInfo, targetShiftInfo) {
  return sendSwapRequestEmail({
    email: targetEmployeeEmail,
    requesterName,
    targetEmployeeName,
    originalShiftInfo,
    targetShiftInfo
  });
}

/**
 * Legacy function names for backwards compatibility
 */
export async function sendSwapReadyForReviewNotification(requesterName, targetEmployeeName, originalShiftInfo, targetShiftInfo) {
  return sendSwapReadyForReviewEmail({
    requesterName,
    targetEmployeeName,
    originalShiftInfo,
    targetShiftInfo
  });
}

/**
 * Legacy function names for backwards compatibility
 */
export async function sendSwapApprovedNotification(requesterEmail, requesterName, targetEmail, targetEmployeeName, originalShiftInfo, targetShiftInfo) {
  return sendSwapReadyForReviewEmail({
    email: requesterEmail,
    requesterName,
    targetEmail,
    targetEmployeeName,
    originalShiftInfo,
    targetShiftInfo
  });
}

/**
 * Legacy function names for backwards compatibility
 */
export async function sendSwapRejectedNotification(requesterEmail, requesterName, targetEmail, targetEmployeeName, rejectionReason = 'Request was rejected') {
  return sendSwapReadyForReviewEmail({
    email: requesterEmail,
    requesterName,
    targetEmail,
    targetEmployeeName,
    rejectionReason
  });
}

/**
 * Helper to format shift info for emails
 */
export function formatShiftInfo(shiftData) {
  if (!shiftData) return 'Unknown shift';
  const date = new Date(shiftData.date).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const time = `${shiftData.start_datetime?.substring(11, 16) || ''} - ${shiftData.end_datetime?.substring(11, 16) || ''}`;
  const type = shiftData.shift_type?.charAt(0).toUpperCase() + shiftData.shift_type?.slice(1);
  return `${date} • ${type} (${time})`;
}

export default {
  initEmailJS,
  sendSwapRequestEmail,
  sendSwapReadyForReviewEmail,
  sendSwapRequestNotification,
  sendSwapReadyForReviewNotification,
  sendSwapApprovedNotification,
  sendSwapRejectedNotification,
  formatShiftInfo
};
