"""Benchmark registry and factory for mcpbr."""

from typing import Any

from .base import Benchmark, BenchmarkTask
from .cybergym import CyberGymBenchmark
from .mcptoolbench import MCPToolBenchmark
from .swebench import SWEBenchmark

__all__ = [
    "Benchmark",
    "BenchmarkTask",
    "SWEBenchmark",
    "CyberGymBenchmark",
    "MCPToolBenchmark",
    "BENCHMARK_REGISTRY",
    "SWEBENCH_DATASETS",
    "create_benchmark",
    "list_benchmarks",
]


# Dataset mapping for SWE-bench variants
SWEBENCH_DATASETS = {
    "swe-bench": "SWE-bench/SWE-bench_Lite",  # Alias for lite (backwards compat)
    "swe-bench-lite": "SWE-bench/SWE-bench_Lite",
    "swe-bench-verified": "SWE-bench/SWE-bench_Verified",
    "swe-bench-full": "SWE-bench/SWE-bench",
}

BENCHMARK_REGISTRY: dict[str, type[SWEBenchmark | CyberGymBenchmark | MCPToolBenchmark]] = {
    "swe-bench": SWEBenchmark,
    "swe-bench-lite": SWEBenchmark,
    "swe-bench-verified": SWEBenchmark,
    "swe-bench-full": SWEBenchmark,
    "cybergym": CyberGymBenchmark,
    "mcptoolbench": MCPToolBenchmark,
}


def create_benchmark(name: str, **kwargs: Any) -> Benchmark:
    """Create a benchmark instance from the registry.

    Args:
        name: Benchmark name (e.g., 'swe-bench-lite', 'cybergym').
        **kwargs: Arguments to pass to the benchmark constructor.

    Returns:
        Benchmark instance.

    Raises:
        ValueError: If benchmark name is not recognized.
    """
    if name not in BENCHMARK_REGISTRY:
        available = ", ".join(BENCHMARK_REGISTRY.keys())
        raise ValueError(f"Unknown benchmark: {name}. Available: {available}")

    benchmark_class = BENCHMARK_REGISTRY[name]

    # For SWE-bench variants, auto-set the dataset if not provided
    if name in SWEBENCH_DATASETS and "dataset" not in kwargs:
        kwargs["dataset"] = SWEBENCH_DATASETS[name]

    return benchmark_class(**kwargs)


def list_benchmarks() -> list[str]:
    """List available benchmark names.

    Returns:
        List of benchmark names.
    """
    return list(BENCHMARK_REGISTRY.keys())
