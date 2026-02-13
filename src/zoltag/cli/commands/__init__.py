"""CLI commands package."""

from . import (
    ingest,
    metadata,
    embeddings,
    training,
    tagging,
    sync,
    inspect,
    thumbnails,
)

__all__ = [
    'ingest',
    'metadata',
    'embeddings',
    'training',
    'tagging',
    'sync',
    'inspect',
    'thumbnails',
]
