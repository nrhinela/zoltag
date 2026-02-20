"""Zoltag CLI entry point with lazy command registration."""

from __future__ import annotations

import click

_COMMANDS_REGISTERED = False


def _register_commands_once() -> None:
    global _COMMANDS_REGISTERED
    if _COMMANDS_REGISTERED:
        return

    from .commands import (
        embeddings,
        face_recognition,
        ingest,
        inspect,
        metadata,
        sync,
        tagging,
        text_index,
        thumbnails,
        training,
    )

    # Register commands (names must match existing CLI for backward compatibility)
    cli.add_command(ingest.ingest_command, name="ingest")
    cli.add_command(metadata.refresh_metadata_command, name="refresh-metadata")
    cli.add_command(metadata.backfill_capture_timestamp_command, name="backfill-missing-media-info")
    cli.add_command(embeddings.build_embeddings_command, name="build-embeddings")
    cli.add_command(training.train_keyword_models_command, name="train-keyword-models")
    cli.add_command(training.recompute_trained_tags_command, name="recompute-trained-tags")
    cli.add_command(tagging.recompute_zeroshot_tags_command, name="recompute-zeroshot-tags")
    cli.add_command(face_recognition.recompute_face_detections_command, name="recompute-face-detections")
    cli.add_command(face_recognition.recompute_face_recognition_tags_command, name="recompute-face-recognition-tags")
    cli.add_command(sync.sync_dropbox_command, name="sync-dropbox")
    cli.add_command(inspect.list_images_command, name="list-images")
    cli.add_command(inspect.show_config_command, name="show-config")
    cli.add_command(thumbnails.backfill_thumbnails_command, name="backfill-thumbnails")
    cli.add_command(text_index.rebuild_asset_text_index_command, name="rebuild-asset-text-index")

    _COMMANDS_REGISTERED = True


class _LazyCLIGroup(click.Group):
    def list_commands(self, ctx):
        _register_commands_once()
        return super().list_commands(ctx)

    def get_command(self, ctx, cmd_name):
        _register_commands_once()
        return super().get_command(ctx, cmd_name)


@click.group(cls=_LazyCLIGroup)
def cli():
    """Zoltag CLI for local development and testing."""
    pass


if __name__ == "__main__":
    cli()
