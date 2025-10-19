import os
from typing import Optional
import torch
from PIL import Image

class CLIPAdapter:
    def __init__(self, device: Optional[str] = None, weights_root: Optional[str] = None, backend_preference: Optional[str] = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.backend = None
        self._model = None
        self._preprocess = None
        self._tokenize = None
        self._processor = None

        if weights_root is None:
            weights_root = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cn_clip_model_weights")

        backends = [backend_preference] if backend_preference else ["cn_clip", "hf_cn_clip", "openai_clip"]
        for backend in backends:
            if backend == "cn_clip":
                try:
                    from cn_clip.clip import load_from_name, tokenize
                    self._tokenize = tokenize
                    self._model, self._preprocess = load_from_name("ViT-B-16", device=self.device, download_root=weights_root)
                    self._model.eval()
                    self.backend = "cn_clip"
                    break
                except Exception:
                    pass
            elif backend == "hf_cn_clip":
                try:
                    from transformers import ChineseCLIPProcessor, ChineseCLIPModel
                    self._processor = ChineseCLIPProcessor.from_pretrained("OFA-Sys/chinese-clip-vit-b-16")
                    self._model = ChineseCLIPModel.from_pretrained("OFA-Sys/chinese-clip-vit-b-16").to(self.device)
                    self._model.eval()
                    self.backend = "hf_cn_clip"
                    break
                except Exception:
                    pass
            elif backend == "openai_clip":
                try:
                    import clip
                    self._model, self._preprocess = clip.load("ViT-B/16", device=self.device)
                    self._model.eval()
                    self.backend = "openai_clip"
                    break
                except Exception:
                    pass

        if self.backend is None:
            raise RuntimeError("No CLIP backend available. Install Chinese-CLIP or Transformers/HF Chinese-CLIP, or OpenAI CLIP.")

    def compute_similarity(self, image: Image.Image, text: str) -> float:
        if self.backend == "cn_clip":
            text_tokens = self._tokenize([text]).to(self.device)
            image_tensor = self._preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
            with torch.no_grad():
                image_features = self._model.encode_image(image_tensor)
                text_features = self._model.encode_text(text_tokens)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            return (image_features @ text_features.T)[0][0].item()

        if self.backend == "hf_cn_clip":
            inputs = self._processor(text=[text], images=image.convert("RGB"), return_tensors="pt")
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            with torch.no_grad():
                text_features = self._model.get_text_features(input_ids=inputs["input_ids"], attention_mask=inputs["attention_mask"])
                image_features = self._model.get_image_features(pixel_values=inputs["pixel_values"])
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            return (image_features @ text_features.T)[0][0].item()

        if self.backend == "openai_clip":
            import clip
            text_tokens = clip.tokenize([text]).to(self.device)
            image_tensor = self._preprocess(image.convert("RGB")).unsqueeze(0).to(self.device)
            with torch.no_grad():
                image_features = self._model.encode_image(image_tensor)
                text_features = self._model.encode_text(text_tokens)
            image_features = image_features / image_features.norm(dim=-1, keepdim=True)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            return (image_features @ text_features.T)[0][0].item()

        raise RuntimeError("Invalid CLIP backend")