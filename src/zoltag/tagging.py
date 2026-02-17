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

        self.model_name = model_name
        self.model_version = model_name
        try:
            self.model = SiglipModel.from_pretrained(model_name)
            self.processor = SiglipProcessor.from_pretrained(model_name, use_fast=False)
        except OSError:
            # Some HF/transformers versions attempt a network HEAD for processor_config.json
            # even when local cache contains preprocessor_config.json. Fall back to cached files.
            self.model = SiglipModel.from_pretrained(model_name, local_files_only=True)
            self.processor = SiglipProcessor.from_pretrained(
                model_name,
                use_fast=False,
                local_files_only=True,
            )
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model.to(self.device)
        self.model.eval()
        self.model_type = "siglip"

    @staticmethod
    def _extract_embedding_tensor(features, source: str) -> torch.Tensor:
        """Extract a tensor embedding from raw tensor, tuple, or model output objects."""
        if torch.is_tensor(features):
            return features

        # Recent transformers versions may return tuples or BaseModelOutputWithPooling.
        if isinstance(features, tuple):
            for item in features:
                if torch.is_tensor(item):
                    return item

        for attr in ("image_embeds", "text_embeds", "pooler_output", "last_hidden_state"):
            value = getattr(features, attr, None)
            if torch.is_tensor(value):
                if attr == "last_hidden_state" and value.ndim == 3:
                    # Fallback to CLS token representation when pooled output is absent.
                    return value[:, 0, :]
                return value

        raise TypeError(f"Unsupported {source} output type: {type(features)!r}")

    @staticmethod
    def _normalize_embeddings(embeddings: torch.Tensor) -> torch.Tensor:
        """L2-normalize embeddings row-wise with shape safeguards."""
        if embeddings.ndim == 1:
            embeddings = embeddings.unsqueeze(0)
        elif embeddings.ndim == 3:
            embeddings = embeddings[:, 0, :]

        if embeddings.ndim != 2:
            raise ValueError(f"Expected 2D embedding tensor, got shape {tuple(embeddings.shape)}")

        norms = embeddings.norm(dim=-1, keepdim=True).clamp_min(1e-12)
        return embeddings / norms

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
            prompt = kw.get('prompt') or f"a photo of {keyword}"
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

        # Filter by threshold and return with confidence scores
        results = []
        for keyword, confidence in zip(keywords, probs):
            if confidence >= threshold:
                results.append((keyword, float(confidence)))

        # Sort by confidence
        results.sort(key=lambda x: x[1], reverse=True)
        return results

    def build_text_embeddings(
        self,
        candidate_keywords: List[dict]
    ) -> Tuple[List[str], torch.Tensor]:
        """Build normalized text embeddings for keyword prompts."""
        if not candidate_keywords:
            return [], torch.empty(0)

        text_prompts = []
        keywords = []
        for kw in candidate_keywords:
            keyword = kw['keyword']
            prompt = kw.get('prompt') or f"a photo of {keyword}"
            text_prompts.append(prompt)
            keywords.append(keyword)

        with torch.no_grad():
            inputs = self.processor(
                text=text_prompts,
                return_tensors="pt",
                padding=True
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            text_outputs = self.model.get_text_features(**inputs)
            text_embeds = self._extract_embedding_tensor(text_outputs, "text_features")
            text_embeds = self._normalize_embeddings(text_embeds)

        return keywords, text_embeds

    def score_with_embedding(
        self,
        image_embedding: List[float],
        keywords: List[str],
        text_embeddings: torch.Tensor,
        threshold: float = 0.25
    ) -> List[Tuple[str, float]]:
        """Score keywords using a precomputed image embedding."""
        if not keywords or text_embeddings.numel() == 0:
            return []

        with torch.no_grad():
            image_tensor = torch.tensor(
                image_embedding,
                dtype=text_embeddings.dtype,
                device=text_embeddings.device
            )
            image_tensor = image_tensor / image_tensor.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            logits = torch.matmul(image_tensor, text_embeddings.t())
            logit_scale = getattr(self.model, "logit_scale", None)
            if logit_scale is not None:
                if torch.is_tensor(logit_scale):
                    scale = logit_scale.exp()
                else:
                    scale = torch.tensor(logit_scale, device=logits.device).exp()
                logits = logits * scale
            probs = torch.softmax(logits, dim=0).cpu().numpy()

        results = []
        for keyword, confidence in zip(keywords, probs):
            if confidence >= threshold:
                results.append((keyword, float(confidence)))

        results.sort(key=lambda x: x[1], reverse=True)
        return results

    def image_embedding(self, image_data: bytes) -> List[float]:
        """Return a normalized image embedding for downstream models."""
        image = Image.open(io.BytesIO(image_data))
        if image.mode != "RGB":
            image = image.convert("RGB")

        with torch.no_grad():
            inputs = self.processor(images=image, return_tensors="pt")
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            # SigLIP requires text inputs for full forward; use image-only helper instead.
            image_outputs = self.model.get_image_features(**inputs)
            image_embeds = self._extract_embedding_tensor(image_outputs, "image_features")
            image_embeds = self._normalize_embeddings(image_embeds)
            embedding = image_embeds[0].cpu().numpy().tolist()

        return embedding


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


def get_image_embedding(image_data: bytes, model_type: str = "siglip") -> List[float]:
    """Compute an image embedding using the configured tagger."""
    tagger = get_tagger(model_type=model_type)
    if hasattr(tagger, "image_embedding"):
        return tagger.image_embedding(image_data)
    raise ValueError(f"Tagger {model_type} does not support image embeddings")

def calculate_tags(machine_tags: list, permatags: list) -> list:
    """
    Calculates the final set of tags based on machine tags and permatags.

    Args:
        machine_tags: A list of dicts, e.g., [{"keyword": "dog", ...}, ...].
        permatags: A list of dicts from the Permatag model, e.g., [{"keyword": "cat", "signum": -1}, ...].

    Returns:
        A list of dicts representing the final calculated tags.
    """
    calculated_tag_objects = {tag['keyword']: tag for tag in machine_tags}

    # Apply permatags
    for ptag in permatags:
        keyword = ptag['keyword']
        if ptag['signum'] == -1 and keyword in calculated_tag_objects:
            # Negative permatag: remove from set
            del calculated_tag_objects[keyword]
        elif ptag['signum'] == 1 and keyword not in calculated_tag_objects:
            # Positive permatag: add to set if not present
            calculated_tag_objects[keyword] = {
                "keyword": keyword,
                "category": ptag['category'],
                "confidence": 1.0, # Assign full confidence for manual tags
                "manual": True # Add a flag to identify it
            }

    # Return as a sorted list
    return sorted(list(calculated_tag_objects.values()), key=lambda x: x['keyword'])
