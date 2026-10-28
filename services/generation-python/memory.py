"""Sample process and device allocation separately; unified memory is not additive."""
import threading


class MemorySample:
    def __init__(self, torch, device):
        self.torch, self.device = torch, device
        self.stop = threading.Event()
        self.values = {'sampleIntervalSeconds': .05, 'peakRssBytes': 0, 'minSystemAvailableBytes': None}

    def sample(self):
        import psutil
        self.values['peakRssBytes'] = max(self.values['peakRssBytes'], psutil.Process().memory_info().rss)
        free = psutil.virtual_memory().available
        self.values['minSystemAvailableBytes'] = min(self.values['minSystemAvailableBytes'] or free, free)
        if self.device == 'mps':
            for name, fn in [('peakDeviceAllocatedBytes', 'current_allocated_memory'), ('peakDriverAllocatedBytes', 'driver_allocated_memory')]:
                self.values[name] = max(self.values.get(name, 0), getattr(self.torch.mps, fn)())
        elif self.device == 'cuda':
            self.values['peakDeviceAllocatedBytes'] = self.torch.cuda.max_memory_allocated()
            self.values['peakDriverAllocatedBytes'] = self.torch.cuda.max_memory_reserved()

    def __enter__(self):
        if self.device == 'cuda': self.torch.cuda.reset_peak_memory_stats()
        self.sample()
        def run():
            while not self.stop.wait(.05): self.sample()
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()
        self.sample()
