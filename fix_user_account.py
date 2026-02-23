"""Fix user account after Supabase UUID change.

This script updates all tables with foreign key references to user_profiles
to use the new Supabase UUID after the user account was recreated.

Strategy:
1. Insert new user_profiles row with new UUID (duplicate email temporarily)
2. Update all child tables to point to new UUID
3. Delete old user_profiles row with old UUID
"""

import sys
from sqlalchemy import text
from zoltag.database import SessionLocal
from zoltag.settings import settings

OLD_UUID = "edfea154-4aba-4338-bede-1a215895f6da"
NEW_UUID = "de8656c3-e77b-4de3-84df-ed2abdfedb50"
EMAIL = "ned.rhinelander@gmail.com"

# All tables and columns that reference user_profiles.supabase_uid
FOREIGN_KEY_UPDATES = [
    ("activity_events", "actor_supabase_uid"),
    ("asset_derivatives", "created_by"),
    ("asset_notes", "created_by"),
    ("assets", "created_by"),
    ("invitations", "invited_by"),
    ("job_triggers", "created_by"),
    ("jobs", "created_by"),
    ("permatags", "created_by"),
    ("person_reference_images", "created_by"),
    ("photo_lists", "created_by_uid"),
    ("user_tenants", "invited_by"),
    ("user_tenants", "supabase_uid"),
    ("workflow_runs", "created_by"),
]


def main():
    """Update foreign key references and user_profiles table."""
    print(f"Fixing user account for {EMAIL}")
    print(f"Old UUID: {OLD_UUID}")
    print(f"New UUID: {NEW_UUID}")
    print()

    session = SessionLocal()
    try:
        # Check current state
        print("Checking current state...")

        # Get old user_profiles row
        result = session.execute(
            text("SELECT * FROM user_profiles WHERE email = :email"),
            {"email": EMAIL}
        )
        old_row = result.fetchone()
        if not old_row:
            print("ERROR: No user_profiles record found!")
            sys.exit(1)

        print(f"  user_profiles: supabase_uid={old_row.supabase_uid}")

        # Check each table for records with old UUID
        total_records = 0
        for table, column in FOREIGN_KEY_UPDATES:
            result = session.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :old_uuid"),
                {"old_uuid": OLD_UUID}
            )
            count = result.scalar()
            if count > 0:
                print(f"  {table}.{column}: {count} records")
                total_records += count

        print()
        print(f"Total records to update: {total_records}")

        # Check for --confirm flag
        if "--confirm" not in sys.argv:
            print()
            print("Run with --confirm to proceed with the update")
            sys.exit(0)

        print()
        print("Updating database...")

        # Step 1: Temporarily drop UNIQUE constraint on email
        print("  Temporarily removing email uniqueness constraint...")
        session.execute(text("ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_key"))

        # Step 2: Insert new user_profiles row with new UUID (copy all data from old row)
        print(f"  Inserting new user_profiles row with UUID {NEW_UUID}")
        # Get column names
        result = session.execute(text("SELECT * FROM user_profiles LIMIT 0"))
        columns = [col for col in result.keys() if col != 'supabase_uid']

        # Build INSERT statement
        cols_str = ', '.join(columns)
        session.execute(text(f"""
            INSERT INTO user_profiles (supabase_uid, {cols_str})
            SELECT :new_uuid, {cols_str}
            FROM user_profiles
            WHERE supabase_uid = :old_uuid
        """), {"new_uuid": NEW_UUID, "old_uuid": OLD_UUID})

        # Step 3: Update all child tables
        for table, column in FOREIGN_KEY_UPDATES:
            result = session.execute(
                text(f"UPDATE {table} SET {column} = :new_uuid WHERE {column} = :old_uuid"),
                {"new_uuid": NEW_UUID, "old_uuid": OLD_UUID}
            )
            if result.rowcount > 0:
                print(f"  Updated {table}.{column}: {result.rowcount} records")

        # Step 4: Delete old user_profiles row
        print(f"  Deleting old user_profiles row with UUID {OLD_UUID}")
        session.execute(
            text("DELETE FROM user_profiles WHERE supabase_uid = :old_uuid"),
            {"old_uuid": OLD_UUID}
        )

        # Step 5: Restore UNIQUE constraint on email
        print("  Restoring email uniqueness constraint...")
        session.execute(text("ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_email_key UNIQUE (email)"))

        # Commit the transaction
        session.commit()
        print()
        print("✅ Account fixed successfully!")
        print(f"You should now be able to log in with {EMAIL}")
    except Exception as e:
        session.rollback()
        print(f"\n❌ Error: {e}")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    main()
