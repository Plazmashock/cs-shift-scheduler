# Daily Slack Shift Notifications Setup Guide

This guide explains how to configure automated daily shift notifications to admins via Slack DMs.

## Overview

The system sends a daily summary of shifts and leaves to admin users via Slack direct messages at **9:00 AM (Asia/Tbilisi timezone)** each day. The message includes:

- All shifts organized by type (Morning, Day, Afternoon, Night)
- Employees assigned to each shift
- Employees on leave with timeframe details (Full Day, First Half, Second Half)
- Personalized 1:1 catchup suggestions for each manager (based on shift overlap)

## Architecture

```
Cloud Scheduler → Cloud Run Backend (/api/send-daily-shifts) → Slack API → Admin DMs
```

## Prerequisites

1. **Slack Workspace & Bot Token**
   - You already have Slack integration configured (from swap request notifications)
   - The same bot token is used for daily notifications
   - Bot must have `users:read.email` and `chat:write` scopes

2. **Google Cloud Project**
   - Project ID: `industrial-gist-470307-k4`
   - Cloud Run service: `cs-scheduler-io-v2` (region: europe-west1)
   - Cloud Scheduler enabled

3. **Firebase RTDB**
   - Settings stored at: `admin/slack_notification_settings`

---

## Step 1: Configure Settings in UI

1. **Login as Admin**
   - Go to https://cs-scheduler-app.web.app
   - Navigate to **Settings** tab

2. **Configure Daily Notifications Section**
   - **Enable Daily Notifications**: Toggle ON
   - **Notification Time**: Fixed at 9:00 AM (Asia/Tbilisi timezone)
     - Note: Time is configured in Google Cloud Scheduler and cannot be changed from the UI
     - To change the time, you must update the Cloud Scheduler job (see "Changing Notification Time" section below)
   - **Send Notifications on Weekends**: Toggle based on preference
   - **Admin Responsibilities**: Assign employees to admins
     - Each admin will only see their assigned employees in 1:1 catchup suggestions

3. **Test the Notification**
   - Click **Send Test Notification** button
   - This sends ONLY to kordzadze2002@gmail.com (for safety)
   - Check Slack DMs to verify message format
   - Admins should receive a message like:

```
📅 Shift Schedule for Wednesday, June 11, 2026

🌅 Morning (04:00–13:00)
• Beka Chkheidze
• Eka Tsiklauri

☀️ Day (10:00–19:00)
• Nino Beridze
• Luka Japaridze

🌆 Afternoon (15:00–00:00)
• Teona Abashidze

🌙 Night (19:00–04:00)
• Sandro Kiknadze

🏖️ On Leave
• Meri Dolidze (Full Day)
• Irakli Kapanadze (First Half - Morning)
```

4. **Save Settings**
   - Click **Save Settings** button
   - Settings are stored in Firebase RTDB

---

## Step 2: Create Cloud Scheduler Job

### Via Google Cloud Console (Recommended)

1. **Open Cloud Scheduler**
   ```
   https://console.cloud.google.com/cloudscheduler?project=industrial-gist-470307-k4
   ```

2. **Create Job**
   - Click **CREATE JOB**
   - Fill in the following:

   **Job Details:**
   - **Name**: `daily-shift-notifications`
   - **Region**: `europe-west1` (must match Cloud Run service)
   - **Description**: `Send daily shift schedules to admins via Slack`
   - **Frequency (cron)**: Based on configured time in Settings UI
     - For 9:00 AM Tbilisi: `0 9 * * *`
     - For 8:00 AM Tbilisi: `0 8 * * *`
     - For 10:30 AM Tbilisi: `30 10 * * *`
   - **Timezone**: `Asia/Tbilisi`

   **Execution:**
   - **Target type**: `HTTP`
   - **URL**: `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/api/send-daily-shifts`
   - **HTTP method**: `POST`
   - **Body**: 
     ```json
     {}
     ```
   
   **Auth:**
   - **Auth header**: `Add OIDC token`
   - **Service account**: `000000000000-compute@developer.gserviceaccount.com`
     - (Default Cloud Run service account)
   - **Audience**: `https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app`

   **Advanced:**
   - **Retry configuration**: 
     - **Max retry attempts**: `3`
     - **Max retry duration**: `15 minutes`
     - **Min backoff**: `5 seconds`
     - **Max backoff**: `1 hour`
     - **Max doublings**: `5`

3. **Create and Test**
   - Click **CREATE**
   - Click **FORCE RUN** to test immediately
   - Check Slack DMs to verify delivery

### Via gcloud CLI

```bash
# Set project
gcloud config set project industrial-gist-470307-k4

# Create scheduler job
gcloud scheduler jobs create http daily-shift-notifications \
  --location=europe-west1 \
  --schedule="0 9 * * *" \
  --time-zone="Asia/Tbilisi" \
  --uri="https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app/api/send-daily-shifts" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body='{}' \
  --oidc-service-account-email="000000000000-compute@developer.gserviceaccount.com" \
  --oidc-token-audience="https://YOUR-CLOUD-RUN-SERVICE.europe-west1.run.app" \
  --max-retry-attempts=3 \
  --max-retry-duration=15m \
  --min-backoff=5s \
  --max-backoff=1h \
  --max-doublings=5

# Test the job
gcloud scheduler jobs run daily-shift-notifications --location=europe-west1

# View job logs
gcloud scheduler jobs describe daily-shift-notifications --location=europe-west1
```

---

## Changing Notification Time (Advanced)

**Current Time**: 9:00 AM Asia/Tbilisi (configured in Cloud Scheduler)

The notification time is **NOT configurable from the UI**. To change it, you must manually update the Google Cloud Scheduler job:

### Via gcloud CLI (Recommended)
```bash
# Example: Change to 10:00 AM Tbilisi time
gcloud scheduler jobs update http daily-shift-notifications \
  --location=europe-west1 \
  --project=industrial-gist-470307-k4 \
  --schedule="0 10 * * *" \
  --time-zone="Asia/Tbilisi"
```

### Via Google Cloud Console
1. Go to [Cloud Scheduler](https://console.cloud.google.com/cloudscheduler?project=industrial-gist-470307-k4)
2. Select region: **europe-west1**
3. Click on `daily-shift-notifications` job
4. Click **EDIT**
5. Update **Frequency (cron)** to match new time (see examples below)
6. Click **UPDATE**

---

## Cron Schedule Examples

| Time (Tbilisi) | Cron Expression | Description |
|----------------|----------------|-------------|
| 8:00 AM | `0 8 * * *` | Every day at 8:00 AM |
| 9:00 AM | `0 9 * * *` | Every day at 9:00 AM |
| 10:30 AM | `30 10 * * *` | Every day at 10:30 AM |
| 6:00 PM | `0 18 * * *` | Every day at 6:00 PM |
| 9:00 AM (weekdays only) | `0 9 * * 1-5` | Monday-Friday at 9:00 AM |

---

## Monitoring & Troubleshooting

### View Scheduler Logs
```bash
# View last 10 executions
gcloud scheduler jobs describe daily-shift-notifications \
  --location=europe-west1 \
  --format="table(name, schedule, lastAttemptTime, state)"

# View Cloud Run logs
gcloud run logs read cs-scheduler-io-v2 \
  --region=europe-west1 \
  --limit=50 \
  | grep "send-daily-shifts"
```

### Common Issues

**1. No messages received**
- Check Cloud Scheduler job status (should be `ENABLED`)
- Run job manually: `gcloud scheduler jobs run daily-shift-notifications --location=europe-west1`
- Check Cloud Run logs for errors
- Verify Slack token is configured in Firebase RTDB at `admin/slack_config/bot_token`

**2. Wrong time**
- Verify timezone is set to `Asia/Tbilisi` in Cloud Scheduler job
- Check cron expression matches configured time
- Remember: Tbilisi is UTC+4

**3. Messages sent on weekends but shouldn't**
- Check Settings UI: **Send Notifications on Weekends** toggle should be OFF
- Note: This setting is checked by the backend, not by Cloud Scheduler
- Cloud Scheduler runs daily, but backend skips weekends if toggle is OFF

**4. Authentication errors**
- Ensure Cloud Scheduler job uses OIDC auth with correct service account
- Verify service account has Cloud Run Invoker role:
  ```bash
  gcloud run services add-iam-policy-binding cs-scheduler-io-v2 \
    --region=europe-west1 \
    --member="serviceAccount:000000000000-compute@developer.gserviceaccount.com" \
    --role="roles/run.invoker"
  ```

**5. Missing employees or incorrect data**
- Verify schedule exists in Firebase RTDB at `schedules/{week_start}`
- Check team members are loaded correctly
- Test notification manually from Settings UI first

---

## Data Flow

1. **Cloud Scheduler triggers** at configured time (e.g., 9:00 AM Tbilisi)
2. **POST request sent** to `/api/send-daily-shifts` with empty body `{}`
3. **Backend loads settings** from Firebase RTDB:
   - `admin/slack_notification_settings` (enabled, notifyOnWeekends)
   - `admin/slack_config/bot_token` (Slack bot token)
   - `admin/admin-emails` (list of admin emails)
4. **Backend checks weekday** (skips if weekend and `notifyOnWeekends` is false)
5. **Backend loads today's schedule**:
   - Finds current week's Monday
   - Loads schedule from `schedules/{week_start}`
   - Filters assignments for today's date
6. **Backend formats message**:
   - Groups shifts by type (Morning, Day, Afternoon, Night)
   - Adds employee names
   - Includes leave records with timeframe labels
7. **Backend sends Slack DMs** to each admin email
8. **Backend returns result** with sent_to list and any errors

---

## Security Notes

- Cloud Scheduler uses OIDC authentication (no API keys needed)
- Service account has minimal permissions (Cloud Run Invoker only)
- Slack bot token stored securely in Firebase RTDB
- Admin authentication required for manual test via UI
- Cloud Scheduler job cannot be triggered without proper service account

---

## Future Enhancements

**Automatic Scheduler Updates** (not yet implemented):
- Frontend could call Cloud Scheduler API to update job when time changes
- Requires additional IAM permissions for web app service account
- Would eliminate manual step when changing notification time

**Per-Admin Filtering** (not yet implemented):
- Use `adminAssignments` from settings to filter employees per admin
- Each admin only sees their assigned employees
- Requires changes to message formatting logic in backend

**Channel Notifications** (not yet implemented):
- Option to post to Slack channel instead of DMs
- Could use for team-wide visibility

---

## Related Documentation

- [Slack Bot Setup](./slack-bot-setup.md) (if exists)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Cloud Run Authentication](https://cloud.google.com/run/docs/authenticating/service-to-service)
- Main Project README: [README.md](../README.md)
- Copilot Instructions: [.github/copilot-instructions.md](../.github/copilot-instructions.md)

---

## Contact

For issues or questions:
- Check Cloud Run logs first
- Test manually from Settings UI
- Verify Slack workspace and bot permissions
- Contact: kordzadze2002@gmail.com

---

**Last Updated**: June 11, 2026  
**Version**: 1.0  
**Status**: ✅ Production Ready
