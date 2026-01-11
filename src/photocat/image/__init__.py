"""Image processing and feature extraction."""

import io
from pathlib import Path
from typing import BinaryIO, Tuple

import imagehash
import numpy as np
from PIL import Image, ExifTags
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


class FaceDetector:
    """Detect and recognize faces in images."""
    
    def __init__(self):
        """Initialize face detector."""
        # Lazy import to avoid loading model at import time
        pass
    
    def detect_faces(self, image_data: bytes) -> list[dict]:
        """Detect faces and return bounding boxes."""
        import face_recognition
        
        # Load image
        image = face_recognition.load_image_file(io.BytesIO(image_data))
        
        # Detect faces
        face_locations = face_recognition.face_locations(image)
        face_encodings = face_recognition.face_encodings(image, face_locations)
        
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
        import face_recognition
        
        face_enc = np.array(face_encoding)
        known_encs = [np.array(enc) for enc in known_encodings]
        
        matches = face_recognition.compare_faces(known_encs, face_enc, tolerance=tolerance)
        return [i for i, match in enumerate(matches) if match]
