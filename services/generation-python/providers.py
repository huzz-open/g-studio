"""Provider registry: transport and asset management never enter an implementation."""

from dataclasses import dataclass, field
from pathlib import Path
import sys


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    version: str
    needs_model: bool = False
    supports_gpu: bool = False
    parameters: dict = field(default_factory=dict)

    def describe(self):
        return {
            "providerId": self.id,
            "name": self.name,
            "version": self.version,
            "parameters": self.parameters,
        }

    def prepare_command(self):
        """Optional isolated preparation process, defined by trusted provider code."""
        return None

    def generate(self, folder: Path, request: dict):
        raise NotImplementedError


class SilhouetteProvider(Provider):
    def generate(self, folder, request):
        from generate import silhouette

        silhouette(folder)


class HunyuanProvider(Provider):
    def prepare_command(self):
        return [sys.executable, str(Path(__file__).with_name("download.py"))]

    def generate(self, folder, request):
        from generate import hunyuan

        hunyuan(folder, request)


PROVIDERS = {
    "hunyuan-mini": HunyuanProvider(
        "hunyuan-mini",
        "Hunyuan3D-2mini-Turbo",
        "f90a0f7df7d5e6f71109cf333f6a95a0ae3194a6",
        True,
        True,
        {
            "steps": {"min": 1, "max": 10, "default": 5, "integer": True, "step": 1},
            "resolution": {
                "min": 128,
                "max": 380,
                "default": 256,
                "integer": True,
                "step": 1,
            },
        },
    ),
    "silhouette": SilhouetteProvider("silhouette", "Silhouette algorithm", "1"),
}
