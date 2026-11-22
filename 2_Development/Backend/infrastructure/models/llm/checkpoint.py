from pathlib import Path
from re import fullmatch


def resolve_hub_revision(model_id: str, revision: str | None) -> str:
    if revision and fullmatch(r"[0-9a-f]{40}", revision):
        return revision

    from huggingface_hub import hf_hub_download

    # Hub files are cached under snapshots/<commit>/, also when loaded offline.
    config_path = Path(hf_hub_download(model_id, "config.json", revision=revision))
    commit = config_path.parent.name
    if config_path.parent.parent.name != "snapshots" or not fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Could not resolve the model to a Hugging Face commit. Supply a commit SHA.")
    return commit
