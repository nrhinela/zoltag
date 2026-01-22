"""PhotoCat CLI entry point with command registration."""

import click
from .commands import (
    ingest,
    metadata,
    embeddings,
    training,
    tagging,
    sync,
    inspect,
    thumbnails,
)


@click.group()
def cli():
    """PhotoCat CLI for local development and testing."""
    pass


# Register commands (names must match existing CLI for backward compatibility)
cli.add_command(ingest.ingest_command, name='ingest')
cli.add_command(metadata.refresh_metadata_command, name='refresh-metadata')
cli.add_command(embeddings.build_embeddings_command, name='build-embeddings')
cli.add_command(training.train_keyword_models_command, name='train-keyword-models')
cli.add_command(training.recompute_trained_tags_command, name='recompute-trained-tags')
cli.add_command(tagging.retag_command, name='retag')
cli.add_command(sync.sync_dropbox_command, name='sync-dropbox')
cli.add_command(inspect.list_images_command, name='list-images')
cli.add_command(inspect.show_config_command, name='show-config')
cli.add_command(thumbnails.backfill_thumbnails_command, name='backfill-thumbnails')


if __name__ == '__main__':
    cli()
