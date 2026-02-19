"""Image and video processing helpers."""

import io
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Tuple

import imagehash
import numpy as np
from PIL import Image, ExifTags, ImageDraw
import cv2

# Register HEIC support if available
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
    HEIC_SUPPORTED = True
except ImportError:
    HEIC_SUPPORTED = False
    print("Warning: pillow-heif not installed. HEIC files will not be supported.")


class ImageProcessor:
    """Process images and extract features."""

    SUPPORTED_FORMATS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"}

    def __init__(self, thumbnail_size: Tuple[int, int] = (256, 256)):
        """Initialize processor."""
        self.thumbnail_size = thumbnail_size

    def is_supported(self, filename: str) -> bool:
        """Check if file format is supported."""
        suffix = Path(filename).suffix.lower()

        # Check HEIC separately since it requires pillow-heif
        if suffix in {".heic", ".heif"}:
            return HEIC_SUPPORTED

        return suffix in self.SUPPORTED_FORMATS
    
    def load_image(self, data: bytes) -> Image.Image:
        """Load image from bytes."""
        return Image.open(io.BytesIO(data))
    
    def create_thumbnail(self, image: Image.Image) -> bytes:
        """Create thumbnail and return as JPEG bytes."""
        # Create a copy and convert to RGB if necessary
        img = image.copy()
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        
        # Use thumbnail method to maintain aspect ratio
        img.thumbnail(self.thumbnail_size, Image.Resampling.LANCZOS)
        
        # Save to bytes
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85, optimize=True)
        return buffer.getvalue()
    
    def extract_exif(self, image: Image.Image) -> dict:
        """Extract EXIF data from image."""
        exif_data = {}
        
        try:
            exif = image.getexif()
            if exif is None:
                return exif_data
            
            for tag_id, value in exif.items():
                tag_name = ExifTags.TAGS.get(tag_id, tag_id)
                
                # Convert non-JSON serializable types
                if hasattr(value, 'numerator') and hasattr(value, 'denominator'):
                    # IFDRational type
                    if value.denominator != 0:
                        value = float(value.numerator) / float(value.denominator)
                    else:
                        value = float(value.numerator)
                elif isinstance(value, bytes):
                    # Convert bytes to string, remove null bytes
                    try:
                        value = value.replace(b'\x00', b'').decode('utf-8', errors='ignore')
                    except:
                        value = str(value)
                elif isinstance(value, str):
                    # Remove null bytes from strings
                    value = value.replace('\x00', '')
                elif isinstance(value, (list, tuple)):
                    # Convert lists/tuples of non-serializable types
                    converted_list = []
                    for item in value:
                        if hasattr(item, 'numerator') and hasattr(item, 'denominator'):
                            if item.denominator != 0:
                                converted_list.append(float(item.numerator) / float(item.denominator))
                            else:
                                converted_list.append(float(item.numerator))
                        else:
                            converted_list.append(item)
                    value = converted_list
                
                exif_data[tag_name] = value
        except Exception as e:
            # Some images may have corrupted EXIF data
            print(f"Warning: Error extracting EXIF data: {e}")
            import traceback
            traceback.print_exc()

        return exif_data
    
    def compute_perceptual_hash(self, image: Image.Image) -> str:
        """Compute perceptual hash for duplicate detection."""
        return str(imagehash.phash(image))
    
    def compute_color_histogram(self, image: Image.Image) -> np.ndarray:
        """Compute color histogram for visual similarity."""
        # Convert to RGB if needed
        if image.mode != "RGB":
            image = image.convert("RGB")
        
        # Convert to numpy array
        img_array = np.array(image)
        
        # Compute histogram for each channel
        hist_r = cv2.calcHist([img_array], [0], None, [64], [0, 256])
        hist_g = cv2.calcHist([img_array], [1], None, [64], [0, 256])
        hist_b = cv2.calcHist([img_array], [2], None, [64], [0, 256])
        
        # Concatenate and normalize
        hist = np.concatenate([hist_r, hist_g, hist_b]).flatten()
        hist = hist / hist.sum()
        
        return hist
    
    def extract_features(self, data: bytes) -> dict:
        """Extract all features from image data."""
        image = self.load_image(data)
        
        return {
            "thumbnail": self.create_thumbnail(image),
            "exif": self.extract_exif(image),
            "perceptual_hash": self.compute_perceptual_hash(image),
            "color_histogram": self.compute_color_histogram(image).tolist(),
            "width": image.width,
            "height": image.height,
            "format": image.format,
        }

    def extract_visual_features(self, image: Image.Image) -> dict:
        """Extract visual features from a PIL image."""
        if image.mode != "RGB":
            image = image.convert("RGB")

        return {
            "width": image.width,
            "height": image.height,
            "format": image.format or "JPEG",
            "perceptual_hash": self.compute_perceptual_hash(image),
            "color_histogram": self.compute_color_histogram(image).tolist(),
        }


SUPPORTED_VIDEO_FORMATS = {
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".mpeg",
    ".mpg",
    ".wmv",
}


def is_supported_video_file(filename: str, mime_type: str | None = None) -> bool:
    """Return True if filename/mime represent a supported video asset."""
    mime = (mime_type or "").strip().lower()
    if mime.startswith("video/"):
        return True
    suffix = Path(filename or "").suffix.lower()
    return suffix in SUPPORTED_VIDEO_FORMATS


def is_supported_media_file(filename: str, mime_type: str | None = None) -> bool:
    """Return True for supported image or video files."""
    if is_supported_video_file(filename, mime_type=mime_type):
        return True
    return ImageProcessor().is_supported(filename or "")


class VideoProcessor:
    """Extract thumbnail and metadata from video bytes."""

    def __init__(self, thumbnail_size: Tuple[int, int] = (256, 256), seek_seconds: float = 1.0):
        self.thumbnail_size = thumbnail_size
        self.seek_seconds = max(0.0, float(seek_seconds or 0.0))
        self._image_processor = ImageProcessor(thumbnail_size=thumbnail_size)

    def create_placeholder_thumbnail(self) -> bytes:
        """Generate a fallback thumbnail when no frame is available."""
        width = int(self.thumbnail_size[0] or 256)
        height = int(self.thumbnail_size[1] or 256)
        image = Image.new("RGB", (width, height), color=(45, 49, 56))
        draw = ImageDraw.Draw(image)
        tri_w = max(28, width // 5)
        tri_h = max(36, height // 4)
        cx = width // 2
        cy = height // 2
        points = [
            (cx - tri_w // 2, cy - tri_h // 2),
            (cx - tri_w // 2, cy + tri_h // 2),
            (cx + tri_w // 2, cy),
        ]
        draw.polygon(points, fill=(239, 242, 247))
        return self._image_processor.create_thumbnail(image)

    def extract_features(self, data: bytes, filename: str = "video") -> dict:
        """Extract metadata and a representative poster thumbnail."""
        suffix = Path(filename or "video.mp4").suffix or ".mp4"
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp_file:
                temp_file.write(data)
                temp_path = temp_file.name

            width, height, duration_ms, format_name = self._probe_video(temp_path)
            frame_bytes = self._extract_frame(temp_path, seek_seconds=self.seek_seconds)
            thumbnail_bytes = None
            if frame_bytes:
                try:
                    frame_image = self._image_processor.load_image(frame_bytes)
                    thumbnail_bytes = self._image_processor.create_thumbnail(frame_image)
                except Exception:
                    thumbnail_bytes = None
            if thumbnail_bytes is None:
                thumbnail_bytes = self.create_placeholder_thumbnail()

            return {
                "thumbnail": thumbnail_bytes,
                "width": width,
                "height": height,
                "duration_ms": duration_ms,
                "format": format_name or suffix.lstrip(".").upper() or None,
            }
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    def _probe_video(self, video_path: str) -> tuple[int | None, int | None, int | None, str | None]:
        if shutil.which("ffprobe") is None:
            return None, None, None, None
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=width,height,duration",
            "-select_streams",
            "v:0",
            "-of",
            "json",
            video_path,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except Exception:
            return None, None, None, None

        try:
            payload = json.loads(result.stdout or "{}")
        except Exception:
            payload = {}

        stream = ((payload.get("streams") or [None])[0]) or {}
        fmt = payload.get("format") or {}
        width = _to_int(stream.get("width"))
        height = _to_int(stream.get("height"))
        duration_ms = _duration_to_ms(stream.get("duration")) or _duration_to_ms(fmt.get("duration"))
        format_name = None
        if fmt.get("format_name"):
            format_name = str(fmt.get("format_name")).split(",")[0].upper()
        return width, height, duration_ms, format_name

    def _extract_frame(self, video_path: str, seek_seconds: float = 1.0) -> bytes | None:
        if shutil.which("ffmpeg") is None:
            return None
        seek_value = max(0.0, float(seek_seconds or 0.0))
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seek_value:.3f}",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "pipe:1",
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, check=True)
        except Exception:
            return None
        data = result.stdout or b""
        return data if data else None


def _to_int(value) -> int | None:
    try:
        if value is None:
            return None
        return int(float(value))
    except Exception:
        return None


def _duration_to_ms(value) -> int | None:
    try:
        if value is None:
            return None
        seconds = float(value)
        if not np.isfinite(seconds) or seconds < 0:
            return None
        return int(round(seconds * 1000))
    except Exception:
        return None


class FaceDetector:
    """Detect and recognize faces in images."""
    
    def __init__(self):
        """Initialize face detector."""
        # Lazy import to avoid loading model at import time
        pass
    
    def detect_faces(self, image_data: bytes) -> list[dict]:
        """Detect faces and return bounding boxes."""
        try:
            import face_recognition
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "Missing optional dependency 'face_recognition'. "
                "Install with: pip install '.[ml]' (or pip install face-recognition)."
            ) from exc
        
        # Normalize image into an 8-bit contiguous RGB array accepted by dlib.
        image_array = np.frombuffer(image_data, dtype=np.uint8)
        image_bgr = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
        if image_bgr is not None:
            image = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            image = np.ascontiguousarray(image, dtype=np.uint8)
        else:
            # Fallback for unusual formats OpenCV couldn't decode.
            pil_image = Image.open(io.BytesIO(image_data))
            if pil_image.mode != "RGB":
                pil_image = pil_image.convert("RGB")
            image = np.ascontiguousarray(np.asarray(pil_image), dtype=np.uint8)
        
        # Detect faces
        try:
            face_locations = face_recognition.face_locations(image)
            face_encodings = face_recognition.face_encodings(image, face_locations)
        except Exception as exc:
            raise RuntimeError(
                "Face detection failed "
                f"(shape={getattr(image, 'shape', None)}, "
                f"dtype={getattr(image, 'dtype', None)}, "
                f"contiguous={bool(getattr(image, 'flags', {}).c_contiguous if hasattr(getattr(image, 'flags', None), 'c_contiguous') else False)}): {exc}"
            ) from exc
        
        results = []
        for location, encoding in zip(face_locations, face_encodings):
            top, right, bottom, left = location
            results.append({
                "bounding_box": {"top": top, "right": right, "bottom": bottom, "left": left},
                "encoding": encoding.tolist(),
            })
        
        return results
    
    def match_face(
        self,
        face_encoding: list[float],
        known_encodings: list[list[float]],
        tolerance: float = 0.6
    ) -> list[int]:
        """Match a face encoding against known encodings."""
        try:
            import face_recognition
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "Missing optional dependency 'face_recognition'. "
                "Install with: pip install '.[ml]' (or pip install face-recognition)."
            ) from exc
        
        face_enc = np.array(face_encoding)
        known_encs = [np.array(enc) for enc in known_encodings]
        
        matches = face_recognition.compare_faces(known_encs, face_enc, tolerance=tolerance)
        return [i for i, match in enumerate(matches) if match]
