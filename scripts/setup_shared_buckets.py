#!/usr/bin/env python3
"""
Setup shared GCS buckets for DEV and PROD environments.

This script:
1. Creates photocat-483622-DEV-shared bucket (public for thumbnails)
2. Creates photocat-483622-PROD-shared bucket (public for thumbnails)
3. Configures appropriate permissions and lifecycle policies

Usage:
    # Setup both DEV and PROD
    python scripts/setup_shared_buckets.py

    # Setup only DEV
    python scripts/setup_shared_buckets.py --env dev

    # Setup only PROD
    python scripts/setup_shared_buckets.py --env prod
"""

import argparse
import sys
from google.cloud import storage

# Add parent directory to path to import photocat
sys.path.insert(0, '/Users/ned.rhinelander/Developer/photocat/src')

from photocat.settings import settings


def create_shared_bucket(storage_client, project_id: str, env: str):
    """Create a shared bucket for the specified environment."""

    # Use lowercase for GCS bucket name compatibility
    bucket_name = f"{project_id}-{env.lower()}-shared"

    print(f"\n=== Setting up shared bucket for {env} environment ===")
    print(f"Bucket name: {bucket_name}")

    try:
        # Check if bucket already exists
        bucket = storage_client.get_bucket(bucket_name)
        print(f"✓ Bucket {bucket_name} already exists")
    except Exception:
        # Create the bucket
        print(f"Creating bucket {bucket_name}...")
        bucket = storage_client.create_bucket(
            bucket_name,
            location=settings.gcp_region or "US"
        )
        print(f"✓ Created bucket {bucket_name}")

    # Configure public read access (for CDN delivery of thumbnails)
    print("Configuring public read access...")
    policy = bucket.get_iam_policy(requested_policy_version=3)

    # Check if public access is already configured
    has_public_access = False
    for binding in policy.bindings:
        if binding["role"] == "roles/storage.objectViewer" and "allUsers" in binding["members"]:
            has_public_access = True
            break

    if not has_public_access:
        policy.bindings.append({
            "role": "roles/storage.objectViewer",
            "members": {"allUsers"}
        })
        bucket.set_iam_policy(policy)
        print(f"✓ Configured public read access for {bucket_name}")
    else:
        print(f"✓ Public read access already configured for {bucket_name}")

    # Set CORS configuration (for web access)
    print("Configuring CORS...")
    bucket.cors = [
        {
            "origin": ["*"],
            "method": ["GET", "HEAD"],
            "responseHeader": ["Content-Type"],
            "maxAgeSeconds": 3600
        }
    ]
    bucket.patch()
    print(f"✓ Configured CORS for {bucket_name}")

    # Set lifecycle policy (optional: delete thumbnails older than 90 days)
    # Uncomment if you want automatic cleanup
    # print("Configuring lifecycle policy...")
    # bucket.lifecycle_rules = [
    #     {
    #         "action": {"type": "Delete"},
    #         "condition": {"age": 90}  # Delete after 90 days
    #     }
    # ]
    # bucket.patch()
    # print(f"✓ Configured lifecycle policy for {bucket_name}")

    print(f"\n✓ Shared bucket {bucket_name} is ready!")
    print(f"  Public URL: https://storage.googleapis.com/{bucket_name}/{{path}}")
    print(f"  Example: https://storage.googleapis.com/{bucket_name}/demo/thumbnails/image_thumb.jpg")

    return bucket


def main():
    parser = argparse.ArgumentParser(
        description="Setup shared GCS buckets for DEV and PROD environments"
    )
    parser.add_argument(
        "--env",
        choices=["dev", "prod", "both"],
        default="both",
        help="Which environment to setup (default: both)"
    )

    args = parser.parse_args()

    print("=== PhotoCat Shared Bucket Setup ===")
    print(f"Project: {settings.gcp_project_id}")
    print(f"Region: {settings.gcp_region}")
    print()

    # Confirm with user
    if args.env == "both":
        print("This will create/configure shared buckets for both DEV and PROD environments.")
    else:
        print(f"This will create/configure shared bucket for {args.env.upper()} environment.")

    confirm = input("Continue? (yes/no): ")
    if confirm.lower() != 'yes':
        print("Aborted.")
        return False

    # Initialize storage client
    storage_client = storage.Client(project=settings.gcp_project_id)

    success = True

    # Setup DEV bucket
    if args.env in ["dev", "both"]:
        try:
            create_shared_bucket(storage_client, settings.gcp_project_id, "DEV")
        except Exception as e:
            print(f"\n✗ Failed to setup DEV bucket: {e}")
            success = False

    # Setup PROD bucket
    if args.env in ["prod", "both"]:
        try:
            create_shared_bucket(storage_client, settings.gcp_project_id, "PROD")
        except Exception as e:
            print(f"\n✗ Failed to setup PROD bucket: {e}")
            success = False

    if success:
        print("\n=== Setup complete! ===")
        print("\nNext steps:")
        print("1. New uploads will automatically use the appropriate shared bucket")
        print("2. To create dedicated tenant buckets, use:")
        print("   python scripts/setup_tenant_buckets.py --tenant-id <tenant_id>")
        print("\nBucket naming convention:")
        print("  - Shared: {project}-{env}-shared")
        print("  - Dedicated: {project}-{env}-{tenant_id}")
        print("  - Paths always include tenant ID: {tenant_id}/thumbnails/{filename}")

    return success


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
