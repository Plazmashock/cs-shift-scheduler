#!/usr/bin/env python3
"""
Script to populate Firestore with team members using the scheduler_api backend
"""

import sys
import os

# Add the project root to path so we can import scheduler_api
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Initialize Firebase before importing firestore
try:
    import firebase_admin
    from firebase_admin import initialize_app, firestore
    
    # Try to initialize with default credentials
    if not firebase_admin._apps:
        try:
            initialize_app()
            print("✓ Firebase initialized with Application Default Credentials")
        except Exception as e:
            # Try with explicit project ID
            initialize_app(options={'projectId': 'your-project-id'})
            print("✓ Firebase initialized with project ID: your-project-id")
    
except Exception as e:
    print(f"Error initializing Firebase: {e}")
    print("\nPlease ensure you have:")
    print("  1. Set GOOGLE_APPLICATION_CREDENTIALS environment variable")
    print("  2. Or logged in with: firebase login:use <project>")
    sys.exit(1)

db = firestore.client()

# 14 team members with names and emails
TEAM_MEMBERS = [
    {"id": 1, "name": "Nia Kavtaradze", "email": "nia.kavtaradze@example.com"},
    {"id": 2, "name": "Tamuna Janelidze", "email": "tamuna.janelidze@example.com"},
    {"id": 3, "name": "Nino Beridze", "email": "nino.beridze@example.com"},
    {"id": 4, "name": "Eka Tsiklauri", "email": "eka.tsiklauri@example.com"},
    {"id": 5, "name": "Mari Kutaladze", "email": "mari.kutaladze@example.com"},
    {"id": 6, "name": "Tako Kvirikashvili", "email": "tako.kvirikashvili@example.com"},
    {"id": 7, "name": "Teona Abashidze", "email": "teona.abashidze@example.com"},
    {"id": 8, "name": "Luka Japaridze", "email": "luka.japaridze@example.com"},
    {"id": 9, "name": "Tamta Gabunia", "email": "tamta.gabunia@example.com"},
    {"id": 10, "name": "Gvantsa Barbakadze", "email": "gvantsa.barbakadze@example.com"},
    {"id": 11, "name": "Lela Alavidze", "email": "lela.alavidze@example.com"},
    {"id": 12, "name": "Dato Lomidze", "email": "dato.lomidze@example.com"},
    {"id": 13, "name": "Irakli Kapanadze", "email": "irakli.kapanadze@example.com"},
    {"id": 14, "name": "Maka Khurtsidze", "email": "maka.khurtsidze@example.com"},
]

print("Populating Firestore with 14 team members...")

try:
    # Add each team member to the 'employees' collection
    for member in TEAM_MEMBERS:
        doc_id = str(member["id"])
        db.collection("employees").document(doc_id).set(member)
        print(f"✓ Added {member['name']} ({member['email']})")

    print(f"\n✅ Successfully populated Firestore with {len(TEAM_MEMBERS)} employees!")
    print("ConfigTab should now display the employee roster.")
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)

