from platform import machine, system

from infrastructure.config import config


def resolve_device(requested: str | None = None) -> str:
    device = config.training_device if requested is None else requested
    if device != "auto":
        return "cuda" if device == "gpu" else device

    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def describe_runtime(device: str, *, mixed_precision: str) -> dict:
    import torch

    runtime = {
        "training_device": device, "platform": system(), "architecture": machine(),
        "torch_version": str(torch.__version__), "base_weight_dtype": "float32",
        "mixed_precision": mixed_precision,
    }
    if device == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("The frozen benchmark requires CUDA. Use a CUDA-enabled backend or a validation pilot.")
        props = torch.cuda.get_device_properties(torch.cuda.current_device())
        runtime.update(gpu_name=props.name, gpu_total_memory_bytes=props.total_memory)
    return runtime
