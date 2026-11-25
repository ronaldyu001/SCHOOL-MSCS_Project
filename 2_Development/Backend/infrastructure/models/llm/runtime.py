from platform import machine, system


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
