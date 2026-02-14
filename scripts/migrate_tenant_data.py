#!/usr/bin/env python3
"""
Migrate existing images from shared bucket to tenant-specific buckets.

This script:
1. Finds all images for a tenant in the database
2. Copies them from shared bucket to tenant bucket
3. Updates database paths (removes tenant prefix if present)
4. Optionally deletes from shared bucket after successful copy

Usage:
    # Dry run (preview what would be copied)
    python scripts/migrate_tenant_data.py --tenant-id demo --dry-run

    # Actually migrate
    python scripts/migrate_tenant_data.py --tenant-id demo

    # Migrate and delete from shared bucket
    python scripts/migrate_tenant_data.py --tenant-id demo --delete-source
"""

import argparse
import sys
from google.cloud import storage
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, '/Users/ned.rhinelander/Developer/photocat/src')

from photocat.settings import settings


def migrate_tenant_data(tenant_ref: str, dry_run: bool = False, delete_source: bool = False):
    """Migrate tenant images from shared bucket to tenant-specific buckets."""

    # Setup database
    engine = create_engine(settings.database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Get tenant info
    result = session.execute(
        text(
            """
            SELECT id, name, storage_bucket, thumbnail_bucket, identifier
            FROM tenants
            WHERE id::text = :tenant_ref
               OR identifier = :tenant_ref
            LIMIT 1
            """
        ),
        {"tenant_ref": tenant_ref}
    ).first()

    if not result:
        print(f"✗ Tenant {tenant_ref} not found in database")
        return False

    tenant_id = str(result[0])
    tenant_name = result[1]
    target_storage_bucket = result[2]
    target_thumbnail_bucket = result[3]
    tenant_identifier = result[4] or tenant_id

    if not target_storage_bucket or not target_thumbnail_bucket:
        print(f"✗ Tenant {tenant_identifier} ({tenant_id}) does not have buckets configured")
        print("  Run: python scripts/setup_tenant_buckets.py --tenant-id", tenant_id)
        return False

    print(f"\n=== Migrating data for tenant: {tenant_name} ({tenant_identifier}, {tenant_id}) ===")
    print(f"Source bucket: {settings.storage_bucket_name}")
    print(f"Target storage bucket: {target_storage_bucket}")
    print(f"Target thumbnail bucket: {target_thumbnail_bucket}")
    print()

    # Get all images for tenant
    images = session.execute(
        text("""
            SELECT id, image_path, thumbnail_path
            FROM image_metadata
            WHERE tenant_id = :tenant_id
            ORDER BY created_at
        """),
        {"tenant_id": tenant_id}
    ).fetchall()

    if not images:
        print(f"No images found for tenant {tenant_identifier} ({tenant_id})")
        return True

    print(f"Found {len(images)} images to migrate")

    if dry_run:
        print("\n=== DRY RUN - No changes will be made ===\n")

    # Setup storage client
    storage_client = storage.Client(project=settings.gcp_project_id)
    source_bucket = storage_client.bucket(settings.storage_bucket_name)
    dest_storage_bucket = storage_client.bucket(target_storage_bucket)
    dest_thumbnail_bucket = storage_client.bucket(target_thumbnail_bucket)

    # Migrate each image
    success_count = 0
    error_count = 0
    updates = []

    for img_id, image_path, thumbnail_path in images:
        try:
            # Determine new paths (strip tenant prefix if present)
            new_image_path = image_path
            new_thumbnail_path = thumbnail_path

            # If paths have tenant prefix like "tenant-demo/...", remove it
            tenant_prefix = f"tenant-{tenant_id}/"
            if new_image_path and new_image_path.startswith(tenant_prefix):
                new_image_path = new_image_path[len(tenant_prefix):]
            if new_thumbnail_path and new_thumbnail_path.startswith(tenant_prefix):
                new_thumbnail_path = new_thumbnail_path[len(tenant_prefix):]

            # Copy image
            if image_path:
                if dry_run:
                    print(f"  Would copy: {image_path} -> {target_storage_bucket}/{new_image_path}")
                else:
                    source_blob = source_bucket.blob(image_path)
                    if source_blob.exists():
                        dest_blob = dest_storage_bucket.blob(new_image_path)
                        if not dest_blob.exists():
                            source_bucket.copy_blob(source_blob, dest_storage_bucket, new_image_path)
                            print(f"  ✓ Copied: {image_path}")
                        else:
                            print(f"  • Skipped (exists): {new_image_path}")
                    else:
                        print(f"  ✗ Source not found: {image_path}")
                        error_count += 1
                        continue

            # Copy thumbnail
            if thumbnail_path:
                if dry_run:
                    print(f"  Would copy: {thumbnail_path} -> {target_thumbnail_bucket}/{new_thumbnail_path}")
                else:
                    source_blob = source_bucket.blob(thumbnail_path)
                    if source_blob.exists():
                        dest_blob = dest_thumbnail_bucket.blob(new_thumbnail_path)
                        if not dest_blob.exists():
                            source_bucket.copy_blob(source_blob, dest_thumbnail_bucket, new_thumbnail_path)
                        else:
                            print(f"  • Skipped thumbnail (exists): {new_thumbnail_path}")
                    else:
                        print(f"  ⚠ Thumbnail not found: {thumbnail_path}")

            # Track update for database
            if not dry_run:
                updates.append({
                    "id": img_id,
                    "image_path": new_image_path,
                    "thumbnail_path": new_thumbnail_path,
                    "old_image_path": image_path,
                    "old_thumbnail_path": thumbnail_path
                })

            success_count += 1

        except Exception as e:
            print(f"  ✗ Error migrating {img_id}: {e}")
            error_count += 1

    # Update database
    if not dry_run and updates:
        print(f"\nUpdating database paths for {len(updates)} images...")
        for update in updates:
            session.execute(
                text("""
                    UPDATE image_metadata
                    SET image_path = :image_path,
                        thumbnail_path = :thumbnail_path
                    WHERE id = :id
                """),
                update
            )
        session.commit()
        print("✓ Database updated")

        # Delete source files if requested
        if delete_source:
            print("\nDeleting source files from shared bucket...")
            deleted = 0
            for update in updates:
                try:
                    if update['old_image_path']:
                        blob = source_bucket.blob(update['old_image_path'])
                        if blob.exists():
                            blob.delete()
                            deleted += 1
                    if update['old_thumbnail_path']:
                        blob = source_bucket.blob(update['old_thumbnail_path'])
                        if blob.exists():
                            blob.delete()
                            deleted += 1
                except Exception as e:
                    print(f"  ⚠ Could not delete: {e}")
            print(f"✓ Deleted {deleted} files from source bucket")

    session.close()

    # Summary
    print(f"\n=== Migration {'Preview' if dry_run else 'Complete'} ===")
    print(f"Success: {success_count}")
    print(f"Errors: {error_count}")

    if dry_run:
        print("\nTo actually migrate, run without --dry-run flag")

    return error_count == 0


def main():
    parser = argparse.ArgumentParser(description="Migrate tenant data to dedicated buckets")
    parser.add_argument("--tenant-id", required=True, help="Tenant ID to migrate")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without making them")
    parser.add_argument("--delete-source", action="store_true",
                       help="Delete files from shared bucket after successful copy")

    args = parser.parse_args()

    if args.delete_source and args.dry_run:
        print("Cannot use --delete-source with --dry-run")
        sys.exit(1)

    success = migrate_tenant_data(args.tenant_id, args.dry_run, args.delete_source)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
