#!/usr/bin/env python3
"""
Setup GCS buckets for a tenant with appropriate permissions.

This script:
1. Creates storage and thumbnail buckets for a tenant
2. Configures public read access on thumbnail bucket (for CDN delivery)
3. Updates tenant record in database
4. Keeps storage bucket private (only your app can write)

Usage:
    python scripts/setup_tenant_buckets.py --tenant-id demo
    python scripts/setup_tenant_buckets.py --tenant-id demo --public-images  # Make images public too
"""

import argparse
import sys
from google.cloud import storage
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Add parent directory to path to import zoltag
sys.path.insert(0, '/Users/ned.rhinelander/Developer/zoltag/src')

from zoltag.settings import settings


def create_bucket_if_not_exists(storage_client, bucket_name, make_public=False):
    """Create a GCS bucket if it doesn't exist."""
    try:
        bucket = storage_client.get_bucket(bucket_name)
        print(f"✓ Bucket {bucket_name} already exists")
        return bucket
    except Exception:
        print(f"Creating bucket {bucket_name}...")
        bucket = storage_client.create_bucket(bucket_name, location=settings.gcp_region or "US")

        if make_public:
            # Make bucket publicly readable
            policy = bucket.get_iam_policy(requested_policy_version=3)
            policy.bindings.append({
                "role": "roles/storage.objectViewer",
                "members": {"allUsers"}
            })
            bucket.set_iam_policy(policy)
            print(f"✓ Made {bucket_name} publicly readable")

        print(f"✓ Created bucket {bucket_name}")
        return bucket


def setup_tenant_buckets(tenant_id: str):
    """Setup dedicated thumbnail bucket for a tenant using environment-aware naming."""

    # Verify DATABASE_URL is set and looks valid
    db_url = settings.database_url
    env = settings.environment

    if db_url == "postgresql://localhost/zoltag":
        print("⚠️  Using LOCAL database (postgresql://localhost/zoltag)")
        confirm = input("Is this correct? Type 'yes' to continue: ")
        if confirm.lower() != 'yes':
            print("Aborted. Set DATABASE_URL environment variable to target the correct database.")
            return False
    elif "localhost:5432" in db_url or "127.0.0.1:5432" in db_url:
        print(f"⚠️  Using local database connection: {db_url}")
        print(f"   Environment: {env}")
        confirm = input("Continue? Type 'yes' to proceed: ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return False
    else:
        print(f"⚠️  Using database: {db_url}")
        confirm = input("Confirm this is correct? Type 'yes' to continue: ")
        if confirm.lower() != 'yes':
            print("Aborted.")
            return False

    # Initialize storage client
    storage_client = storage.Client(project=settings.gcp_project_id)

    # Generate bucket name using environment-aware convention (lowercase for GCS)
    project_id = settings.gcp_project_id
    env = settings.environment.lower()
    thumbnail_bucket_name = f"{project_id}-{env}-{tenant_id}"

    print(f"\n=== Setting up dedicated bucket for tenant: {tenant_id} ===")
    print(f"Environment: {env}")
    print(f"Bucket name: {thumbnail_bucket_name}")
    print(f"Convention: {{project}}-{{env}}-{{tenant_id}}")
    print()

    # Create thumbnail bucket (public for CDN access)
    create_bucket_if_not_exists(storage_client, thumbnail_bucket_name, make_public=True)

    # Update database
    print("\nUpdating tenant record in database...")
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Update tenant with bucket name (only thumbnail_bucket, storage_bucket stays null)
        result = session.execute(
            text("""
                UPDATE tenants
                SET thumbnail_bucket = :thumbnail_bucket,
                    updated_at = now()
                WHERE id = :tenant_id
            """),
            {
                "tenant_id": tenant_id,
                "thumbnail_bucket": thumbnail_bucket_name
            }
        )

        if result.rowcount == 0:
            print(f"✗ Tenant {tenant_id} not found in database!")
            session.close()
            return False

        session.commit()
        print(f"✓ Updated tenant {tenant_id} with thumbnail bucket")

    except Exception as e:
        print(f"✗ Database error: {e}")
        session.rollback()
        return False
    finally:
        session.close()

    print("\n=== Setup complete! ===")
    print(f"\nDedicated bucket created: {thumbnail_bucket_name}")
    print(f"Thumbnail URLs will be:")
    print(f"  https://storage.googleapis.com/{thumbnail_bucket_name}/{{tenant_id}}/thumbnails/{{filename}}")
    print(f"\nExample path: {tenant_id}/thumbnails/image_thumb.jpg")
    print(f"\nNote:")
    print(f"  - Bucket name follows convention: {{project}}-{{env}}-{{tenant_id}}")
    print(f"  - Paths always include tenant ID prefix: {{tenant_id}}/thumbnails/...")
    print(f"  - Full-size images are not stored in GCS (only thumbnails)")

    return True


def main():
    parser = argparse.ArgumentParser(description="Setup GCS thumbnail bucket for a tenant")
    parser.add_argument("--tenant-id", required=True, help="Tenant ID")

    args = parser.parse_args()

    success = setup_tenant_buckets(args.tenant_id)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
