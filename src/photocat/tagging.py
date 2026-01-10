"""Image tagging service supporting CLIP and SigLIP models."""

from typing import List, Tuple, Protocol
from PIL import Image
import io
import torch
from transformers import CLIPProcessor, CLIPModel
import numpy as np

# Register HEIF/HEIC support for Pillow
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass  # HEIC support not available


class ImageTagger(Protocol):
    """Protocol for image tagging models."""
    
    def tag_image(
        self, 
        image_data: bytes, 
        candidate_keywords: List[dict],
        threshold: float = 0.25
    ) -> List[Tuple[str, float]]:
        """Tag an image and return (keyword, confidence) tuples."""
        ...


# Commented out - using SigLIP instead
# class CLIPTagger:
#     """Use CLIP to tag images based on controlled vocabulary."""
#
#     def __init__(self, model_name: str = "openai/clip-vit-base-patch32"):
#         """Initialize CLIP model (cached after first load)."""
#         self.model = CLIPModel.from_pretrained(model_name)
#         self.processor = CLIPProcessor.from_pretrained(model_name)
#         self.device = "cuda" if torch.cuda.is_available() else "cpu"
#         self.model.to(self.device)
#         self.model.eval()
#         self.model_type = "clip"
    
#     def tag_image(
#         self,
#         image_data: bytes,
#         candidate_keywords: List[dict],
#         threshold: float = 0.25
#     ) -> List[Tuple[str, float]]:
#         """
#         Tag an image using CLIP.
#
#         Args:
#             image_data: Image bytes
#             candidate_keywords: List of dicts with 'keyword' and optional 'prompt'
#             threshold: Minimum similarity score (0-1) to apply tag
#
#         Returns:
#             List of (keyword, confidence) tuples
#         """
#         if not candidate_keywords:
#             return []
#
#         # Load image
#         image = Image.open(io.BytesIO(image_data))
#         if image.mode != "RGB":
#             image = image.convert("RGB")
#
#         # Create text prompts for each keyword
#         # Use custom prompt if provided, otherwise default to "a photo of {keyword}"
#         text_prompts = []
#         keywords = []
#         for kw in candidate_keywords:
#             keyword = kw['keyword']
#             prompt = kw.get('prompt', f"a photo of {keyword}")
#             text_prompts.append(prompt)
#             keywords.append(keyword)
#
#         # Process inputs
#         with torch.no_grad():
#             inputs = self.processor(
#                 text=text_prompts,
#                 images=image,
#                 return_tensors="pt",
#                 padding=True
#             )
#             inputs = {k: v.to(self.device) for k, v in inputs.items()}
#
#             # Get similarity scores
#             outputs = self.model(**inputs)
#             logits_per_image = outputs.logits_per_image
#             probs = logits_per_image.softmax(dim=1)[0].cpu().numpy()
#
#         # Filter by threshold and return with confidence scores
#         results = []
#         for keyword, confidence in zip(keywords, probs):
#             if confidence >= threshold:
#                 results.append((keyword, float(confidence)))
#
#         # Sort by confidence
#         results.sort(key=lambda x: x[1], reverse=True)
#         return results


class SigLIPTagger:
    """Use SigLIP for improved zero-shot image tagging."""

    def __init__(self, model_name: str = "google/siglip-so400m-patch14-384"):
        """Initialize SigLIP model (better accuracy than CLIP)."""
        from transformers import SiglipProcessor, SiglipModel

        self.model = SiglipModel.from_pretrained(model_name)
        self.processor = SiglipProcessor.from_pretrained(model_name)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model.to(self.device)
        self.model.eval()
        self.model_type = "siglip"

    def tag_image(
        self,
        image_data: bytes,
        candidate_keywords: List[dict],
        threshold: float = 0.25
    ) -> List[Tuple[str, float]]:
        """
        Tag an image using SigLIP.

        Args:
            image_data: Image bytes
            candidate_keywords: List of dicts with 'keyword' and optional 'prompt'
            threshold: Minimum similarity score (0-1) to apply tag

        Returns:
            List of (keyword, confidence) tuples
        """
        if not candidate_keywords:
            return []

        # Load image
        image = Image.open(io.BytesIO(image_data))
        if image.mode != "RGB":
            image = image.convert("RGB")

        # Create text prompts for each keyword
        text_prompts = []
        keywords = []
        for kw in candidate_keywords:
            keyword = kw['keyword']
            prompt = kw.get('prompt', f"a photo of {keyword}")
            text_prompts.append(prompt)
            keywords.append(keyword)

        # Process inputs
        with torch.no_grad():
            inputs = self.processor(
                text=text_prompts,
                images=image,
                return_tensors="pt",
                padding=True
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}

            # Get similarity scores
            outputs = self.model(**inputs)
            # For SigLIP with AutoModel, access the logits directly
            # The model returns logits_per_image or we compute from image/text embeddings
            if hasattr(outputs, 'logits_per_image'):
                logits_per_image = outputs.logits_per_image
            else:
                # Compute similarity from embeddings
                image_embeds = outputs.image_embeds
                text_embeds = outputs.text_embeds
                # Normalize embeddings
                image_embeds = image_embeds / image_embeds.norm(dim=-1, keepdim=True)
                text_embeds = text_embeds / text_embeds.norm(dim=-1, keepdim=True)
                # Compute cosine similarity
                logits_per_image = torch.matmul(image_embeds, text_embeds.t())

            # SigLIP: use softmax to convert logits to probabilities
            # (similar to CLIP - the sigmoid is used during training, not inference)
            probs = torch.softmax(logits_per_image[0], dim=0).cpu().numpy()

            # Debug logging
            print(f"SigLIP logits shape: {logits_per_image.shape}")
            print(f"SigLIP probs (top 10): {sorted(zip(keywords, probs), key=lambda x: x[1], reverse=True)[:10]}")
            print(f"SigLIP threshold: {threshold}")

        # Filter by threshold and return with confidence scores
        results = []
        for keyword, confidence in zip(keywords, probs):
            if confidence >= threshold:
                results.append((keyword, float(confidence)))

        # Sort by confidence
        results.sort(key=lambda x: x[1], reverse=True)
        return results


# Commented out - using SigLIP instead
# class SigLIP2Tagger:
#     """Use SigLIP-v2 for improved zero-shot image tagging."""
#
#     def __init__(self, model_name: str = "google/siglip-large-patch16-384"):
#         """Initialize SigLIP-v2 model (latest version with improved accuracy)."""
#         from transformers import SiglipProcessor, SiglipModel
#
#         self.model = SiglipModel.from_pretrained(model_name)
#         self.processor = SiglipProcessor.from_pretrained(model_name)
#         self.device = "cuda" if torch.cuda.is_available() else "cpu"
#         self.model.to(self.device)
#         self.model.eval()
#         self.model_type = "siglip2"
#
#     def tag_image(
#         self,
#         image_data: bytes,
#         candidate_keywords: List[dict],
#         threshold: float = 0.25
#     ) -> List[Tuple[str, float]]:
#         """
#         Tag an image using SigLIP-v2.
#
#         Args:
#             image_data: Image bytes
#             candidate_keywords: List of dicts with 'keyword' and optional 'prompt'
#             threshold: Minimum similarity score (0-1) to apply tag
#
#         Returns:
#             List of (keyword, confidence) tuples
#         """
#         if not candidate_keywords:
#             return []
#
#         # Load image
#         image = Image.open(io.BytesIO(image_data))
#         if image.mode != "RGB":
#             image = image.convert("RGB")
#
#         # Create text prompts for each keyword
#         text_prompts = []
#         keywords = []
#         for kw in candidate_keywords:
#             keyword = kw['keyword']
#             prompt = kw.get('prompt', f"a photo of {keyword}")
#             text_prompts.append(prompt)
#             keywords.append(keyword)
#
#         # Process inputs
#         with torch.no_grad():
#             inputs = self.processor(
#                 text=text_prompts,
#                 images=image,
#                 return_tensors="pt",
#                 padding=True
#             )
#             inputs = {k: v.to(self.device) for k, v in inputs.items()}
#
#             # Get similarity scores
#             outputs = self.model(**inputs)
#             # For SigLIP with AutoModel, access the logits directly
#             # The model returns logits_per_image or we compute from image/text embeddings
#             if hasattr(outputs, 'logits_per_image'):
#                 logits_per_image = outputs.logits_per_image
#             else:
#                 # Compute similarity from embeddings
#                 image_embeds = outputs.image_embeds
#                 text_embeds = outputs.text_embeds
#                 # Normalize embeddings
#                 image_embeds = image_embeds / image_embeds.norm(dim=-1, keepdim=True)
#                 text_embeds = text_embeds / text_embeds.norm(dim=-1, keepdim=True)
#                 # Compute cosine similarity
#                 logits_per_image = torch.matmul(image_embeds, text_embeds.t())
#
#             # SigLIP: use softmax to convert logits to probabilities
#             # (similar to CLIP - the sigmoid is used during training, not inference)
#             probs = torch.softmax(logits_per_image[0], dim=0).cpu().numpy()
#
#             # Debug logging
#             print(f"SigLIP2 logits shape: {logits_per_image.shape}")
#             print(f"SigLIP2 probs (top 10): {sorted(zip(keywords, probs), key=lambda x: x[1], reverse=True)[:10]}")
#             print(f"SigLIP2 threshold: {threshold}")
#
#         # Filter by threshold and return with confidence scores
#         results = []
#         for keyword, confidence in zip(keywords, probs):
#             if confidence >= threshold:
#                 results.append((keyword, float(confidence)))
#
#         # Sort by confidence
#         results.sort(key=lambda x: x[1], reverse=True)
#         return results


# Global instances to avoid reloading models on each request
_tagger_instances = {}


def get_tagger(model_type: str = "siglip") -> ImageTagger:
    """
    Get or create global tagger instance.

    Args:
        model_type: Currently only "siglip" is active

    Returns:
        Tagger instance
    """
    global _tagger_instances

    if model_type not in _tagger_instances:
        # if model_type == "clip":
        #     _tagger_instances[model_type] = CLIPTagger()
        if model_type == "siglip":
            _tagger_instances[model_type] = SigLIPTagger()
        # elif model_type == "siglip2":
        #     _tagger_instances[model_type] = SigLIP2Tagger()
        else:
            raise ValueError(f"Unknown model type: {model_type}. Currently only 'siglip' is supported")

    return _tagger_instances[model_type]
