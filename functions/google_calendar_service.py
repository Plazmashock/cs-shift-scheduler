"""
Google Calendar Service
Handles meeting room availability checks and calendar event creation for 1:1 catchup meetings.
"""

from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import logging

logger = logging.getLogger(__name__)

# Scopes required for calendar operations
SCOPES = ['https://www.googleapis.com/auth/calendar']


def get_calendar_service(service_account_json: dict):
    """
    Create and return authenticated Google Calendar service.
    
    Args:
        service_account_json: Service account credentials dict
    
    Returns:
        Google Calendar API service object
    """
    try:
        credentials = service_account.Credentials.from_service_account_info(
            service_account_json,
            scopes=SCOPES
        )
        service = build('calendar', 'v3', credentials=credentials)
        return service
    except Exception as e:
        logger.error(f"Failed to create calendar service: {e}")
        raise


def get_shift_time_boundaries(shift_type: str, date: datetime) -> Tuple[datetime, datetime]:
    """
    Get meeting-eligible time boundaries for a shift type.
    Hard boundaries: 10 AM - 7 PM
    
    Args:
        shift_type: 'morning', 'day', 'afternoon', 'night'
        date: The date for which to calculate boundaries
    
    Returns:
        Tuple of (start_datetime, end_datetime) in local time
    """
    # Define shift boundaries respecting 10 AM - 7 PM limits
    boundaries = {
        'morning': (10, 0, 13, 0),    # 10:00 AM - 1:00 PM
        'day': (10, 0, 19, 0),        # 10:00 AM - 7:00 PM
        'afternoon': (15, 0, 19, 0),  # 3:00 PM - 7:00 PM
        'night': None                  # No meeting scheduling for night shifts
    }
    
    if shift_type not in boundaries or boundaries[shift_type] is None:
        raise ValueError(f"Cannot schedule meetings during {shift_type} shift")
    
    start_hour, start_min, end_hour, end_min = boundaries[shift_type]
    
    start_dt = datetime(date.year, date.month, date.day, start_hour, start_min, 0)
    end_dt = datetime(date.year, date.month, date.day, end_hour, end_min, 0)
    
    return start_dt, end_dt


def find_available_room(
    service,
    room_emails: List[str],
    date: datetime,
    start_time: datetime,
    end_time: datetime,
    duration_minutes: int = 60
) -> Optional[Dict]:
    """
    Find first available meeting room within time window.
    
    Args:
        service: Authenticated Google Calendar service
        room_emails: List of room resource emails to check
        date: Date to search for availability
        start_time: Earliest possible start time
        end_time: Latest possible end time
        duration_minutes: Meeting duration in minutes
    
    Returns:
        Dict with {room_email, room_name, start, end} or None if no room available
    """
    if not room_emails:
        logger.warning("No room emails provided for availability check")
        return None
    
    try:
        # Query freebusy for all rooms
        body = {
            "timeMin": start_time.isoformat() + 'Z',
            "timeMax": end_time.isoformat() + 'Z',
            "items": [{"id": email} for email in room_emails],
            "timeZone": "Asia/Tbilisi"
        }
        
        freebusy_result = service.freebusy().query(body=body).execute()
        calendars = freebusy_result.get('calendars', {})
        
        # Try each room
        for room_email in room_emails:
            room_data = calendars.get(room_email, {})
            busy_times = room_data.get('busy', [])
            
            # Try to find a free slot
            current_start = start_time
            duration = timedelta(minutes=duration_minutes)
            
            while current_start + duration <= end_time:
                current_end = current_start + duration
                
                # Check if this slot overlaps with any busy period
                is_free = True
                for busy in busy_times:
                    busy_start = datetime.fromisoformat(busy['start'].replace('Z', '+00:00'))
                    busy_end = datetime.fromisoformat(busy['end'].replace('Z', '+00:00'))
                    
                    # Check for overlap
                    if not (current_end <= busy_start or current_start >= busy_end):
                        is_free = False
                        break
                
                if is_free:
                    # Get room name from calendar metadata
                    try:
                        room_cal = service.calendars().get(calendarId=room_email).execute()
                        room_name = room_cal.get('summary', room_email)
                    except:
                        room_name = room_email
                    
                    return {
                        'room_email': room_email,
                        'room_name': room_name,
                        'start': current_start,
                        'end': current_end
                    }
                
                # Try next 30-minute slot
                current_start += timedelta(minutes=30)
        
        logger.info(f"No available rooms found between {start_time} and {end_time}")
        return None
        
    except HttpError as e:
        logger.error(f"Error checking room availability: {e}")
        return None


def create_meeting_event(
    service,
    employee_email: str,
    employee_name: str,
    manager_email: str,
    manager_name: str,
    room_email: str,
    room_name: str,
    start_time: datetime,
    end_time: datetime,
    description: str = "1:1 Catchup Meeting"
) -> Optional[str]:
    """
    Create a calendar event for 1:1 meeting with room booking.
    
    Args:
        service: Authenticated Google Calendar service
        employee_email: Employee's email address
        employee_name: Employee's full name
        manager_email: Manager's email address
        manager_name: Manager's full name
        room_email: Meeting room resource email
        room_name: Meeting room display name
        start_time: Meeting start datetime
        end_time: Meeting end datetime
        description: Meeting description
    
    Returns:
        Event ID if successful, None otherwise
    """
    try:
        event = {
            'summary': f'1:1 Catchup: {manager_name} & {employee_name}',
            'location': room_name,
            'description': description,
            'start': {
                'dateTime': start_time.isoformat(),
                'timeZone': 'Asia/Tbilisi',
            },
            'end': {
                'dateTime': end_time.isoformat(),
                'timeZone': 'Asia/Tbilisi',
            },
            'attendees': [
                {'email': employee_email, 'displayName': employee_name, 'responseStatus': 'accepted'},
                {'email': manager_email, 'displayName': manager_name, 'responseStatus': 'accepted'},
                {'email': room_email, 'displayName': room_name, 'resource': True}
            ],
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'popup', 'minutes': 15},
                    {'method': 'email', 'minutes': 60},
                ],
            },
            'guestsCanModify': False,
            'guestsCanInviteOthers': False,
        }
        
        # Create event on manager's calendar
        created_event = service.events().insert(
            calendarId=manager_email,
            body=event,
            sendUpdates='all'  # Send email notifications to all attendees
        ).execute()
        
        event_id = created_event.get('id')
        logger.info(f"Created calendar event {event_id} for {employee_name} & {manager_name}")
        return event_id
        
    except HttpError as e:
        logger.error(f"Error creating calendar event: {e}")
        return None


def cancel_meeting_event(
    service,
    manager_email: str,
    event_id: str,
    send_updates: bool = True
) -> bool:
    """
    Cancel a calendar event.
    
    Args:
        service: Authenticated Google Calendar service
        manager_email: Manager's email (calendar owner)
        event_id: Event ID to cancel
        send_updates: Whether to send cancellation emails
    
    Returns:
        True if successful, False otherwise
    """
    try:
        service.events().delete(
            calendarId=manager_email,
            eventId=event_id,
            sendUpdates='all' if send_updates else 'none'
        ).execute()
        
        logger.info(f"Cancelled calendar event {event_id}")
        return True
        
    except HttpError as e:
        logger.error(f"Error cancelling calendar event: {e}")
        return False
