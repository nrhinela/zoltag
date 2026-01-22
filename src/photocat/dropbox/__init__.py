"""Dropbox API integration with OAuth and file sync."""

import time
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, Optional

from dropbox import Dropbox
from dropbox.exceptions import AuthError, RateLimitError
from dropbox.files import FileMetadata, FolderMetadata, PathOrLink, ThumbnailSize


class DropboxClient:
    """Wrapper for Dropbox API with token management."""
    
    def __init__(
        self,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        app_key: Optional[str] = None,
        app_secret: Optional[str] = None,
    ):
        """Initialize Dropbox client."""
        if not access_token and not refresh_token:
            raise ValueError("DropboxClient requires access_token or refresh_token")
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.token_expires_at: Optional[datetime] = None
        if refresh_token and app_key and app_secret:
            self._client = Dropbox(
                oauth2_refresh_token=refresh_token,
                app_key=app_key,
                app_secret=app_secret,
            )
        elif access_token:
            self._client = Dropbox(access_token)
        else:
            raise ValueError("DropboxClient requires access_token or refresh_token with app credentials")
    
    def _ensure_fresh_token(self) -> None:
        """Refresh access token if expired or expiring soon."""
        if self.token_expires_at is None:
            return
        
        # Refresh if token expires in next 5 minutes
        if datetime.utcnow() + timedelta(minutes=5) >= self.token_expires_at:
            if not self.refresh_token:
                raise AuthError("Access token expired and no refresh token available")
            
            # TODO: Implement token refresh logic with app key/secret
            # This requires Dropbox app credentials from Secret Manager
            pass
    
    def list_folder(
        self,
        path: str = "",
        recursive: bool = False,
        include_deleted: bool = False
    ) -> Iterator[FileMetadata]:
        """List files in a folder, yielding only file entries."""
        self._ensure_fresh_token()
        
        result = self._client.files_list_folder(
            path=path,
            recursive=recursive,
            include_deleted=include_deleted,
        )
        
        while True:
            for entry in result.entries:
                if isinstance(entry, FileMetadata):
                    yield entry
            
            if not result.has_more:
                break
            
            result = self._client.files_list_folder_continue(result.cursor)
    
    def list_folder_continue(self, cursor: str) -> tuple[list[FileMetadata], str, bool]:
        """Continue listing from a cursor (for delta sync)."""
        self._ensure_fresh_token()
        
        result = self._client.files_list_folder_continue(cursor)
        
        files = [entry for entry in result.entries if isinstance(entry, FileMetadata)]
        return files, result.cursor, result.has_more
    
    def download_file(self, path: str) -> bytes:
        """Download file contents."""
        self._ensure_fresh_token()
        
        metadata, response = self._client.files_download(path)
        return response.content
    
    def _coerce_path_or_link(self, path: str | PathOrLink) -> PathOrLink:
        if isinstance(path, PathOrLink):
            return path
        return PathOrLink.path(path)

    def _coerce_thumbnail_size(self, size: str | ThumbnailSize) -> ThumbnailSize:
        if isinstance(size, ThumbnailSize):
            return size
        if isinstance(size, str) and hasattr(ThumbnailSize, size):
            return getattr(ThumbnailSize, size)
        raise ValueError(f"Unsupported thumbnail size: {size}")

    def get_thumbnail(self, path: str, size: str = "w256h256") -> bytes:
        """Get thumbnail for an image file."""
        self._ensure_fresh_token()

        target = self._coerce_path_or_link(path)
        resolved_size = self._coerce_thumbnail_size(size)
        metadata, response = self._client.files_get_thumbnail_v2(target, size=resolved_size)
        return response.content
    
    def get_metadata(self, path: str) -> FileMetadata:
        """Get file metadata."""
        self._ensure_fresh_token()

        metadata = self._client.files_get_metadata(path)
        if not isinstance(metadata, FileMetadata):
            raise ValueError(f"Path is not a file: {path}")
        return metadata


class DropboxWebhookValidator:
    """Validate Dropbox webhook signatures."""
    
    def __init__(self, app_secret: str):
        """Initialize validator with app secret."""
        self.app_secret = app_secret
    
    def validate(self, signature: str, body: bytes) -> bool:
        """Validate webhook signature."""
        import hmac
        import hashlib
        
        expected = hmac.new(
            self.app_secret.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(signature, expected)


def handle_rate_limit(func):
    """Decorator to handle Dropbox rate limiting with exponential backoff."""
    def wrapper(*args, **kwargs):
        max_retries = 5
        base_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                return func(*args, **kwargs)
            except RateLimitError as e:
                if attempt == max_retries - 1:
                    raise
                
                # Exponential backoff with jitter
                delay = base_delay * (2 ** attempt) * (0.5 + 0.5 * time.time() % 1)
                time.sleep(delay)
        
        return func(*args, **kwargs)
    
    return wrapper
