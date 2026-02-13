"""Rate limiting setup using slowapi (in-memory, suitable for single-instance Cloud Run)."""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
