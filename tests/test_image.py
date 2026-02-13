"""Test image processing."""

import pytest
from PIL import Image

from zoltag.image import ImageProcessor, FaceDetector


def test_image_processor_creation():
    """Test creating image processor."""
    processor = ImageProcessor(thumbnail_size=(128, 128))
    assert processor.thumbnail_size == (128, 128)


def test_supported_formats():
    """Test format detection."""
    processor = ImageProcessor()
    
    assert processor.is_supported("image.jpg")
    assert processor.is_supported("image.JPEG")
    assert processor.is_supported("image.png")
    assert processor.is_supported("image.heic")
    assert not processor.is_supported("document.pdf")
    assert not processor.is_supported("video.mp4")


def test_load_image(sample_image_data: bytes):
    """Test loading image from bytes."""
    processor = ImageProcessor()
    image = processor.load_image(sample_image_data)
    
    assert isinstance(image, Image.Image)
    assert image.width == 100
    assert image.height == 100


def test_create_thumbnail(sample_image_data: bytes):
    """Test thumbnail creation."""
    processor = ImageProcessor(thumbnail_size=(50, 50))
    image = processor.load_image(sample_image_data)
    
    thumbnail_data = processor.create_thumbnail(image)
    assert isinstance(thumbnail_data, bytes)
    assert len(thumbnail_data) > 0
    
    # Verify thumbnail is valid JPEG
    thumbnail = processor.load_image(thumbnail_data)
    assert thumbnail.format == "JPEG"
    assert thumbnail.width <= 50
    assert thumbnail.height <= 50


def test_perceptual_hash(sample_image_data: bytes):
    """Test perceptual hash computation."""
    processor = ImageProcessor()
    image = processor.load_image(sample_image_data)
    
    phash = processor.compute_perceptual_hash(image)
    assert isinstance(phash, str)
    assert len(phash) > 0


def test_color_histogram(sample_image_data: bytes):
    """Test color histogram computation."""
    processor = ImageProcessor()
    image = processor.load_image(sample_image_data)
    
    histogram = processor.compute_color_histogram(image)
    assert histogram.shape == (192,)  # 64 bins * 3 channels
    assert abs(histogram.sum() - 1.0) < 0.01  # Normalized


def test_extract_features(sample_image_data: bytes):
    """Test complete feature extraction."""
    processor = ImageProcessor()
    features = processor.extract_features(sample_image_data)
    
    assert "thumbnail" in features
    assert "exif" in features
    assert "perceptual_hash" in features
    assert "color_histogram" in features
    assert "width" in features
    assert "height" in features
    assert "format" in features
    
    assert features["width"] == 100
    assert features["height"] == 100
