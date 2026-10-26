from application.ports.dataset import DatasetPort
from domain.entities import Dataset


class LoadDataset:
    def __init__(self, dataset: DatasetPort) -> None:
        self.dataset = dataset

    def execute(self) -> Dataset:
        return Dataset(
            conversations=tuple(self.dataset.load_conversations()),
            qa=tuple(self.dataset.load_qa()),
        )
