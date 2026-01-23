#!/usr/bin/env python3
"""Test case to reproduce the string concatenation TypeError."""

import sys

import pytest


def test_instance_id_construction():
    """Test the pattern used in harness.py line 312."""

    # Normal case: all strings
    task1 = {"project": "django", "bug_id": "12345"}
    instance_id1 = task1.get(
        "instance_id", f"{task1.get('project', 'unknown')}_{task1.get('bug_id', 'unknown')}"
    )
    print(f"✓ Case 1 (all strings): {instance_id1}")

    # Bug case: bug_id is an integer
    task2 = {
        "project": "django",
        "bug_id": 12345,  # Integer!
    }
    instance_id2 = task2.get(
        "instance_id", f"{task2.get('project', 'unknown')}_{task2.get('bug_id', 'unknown')}"
    )
    print(f"✓ Case 2 (bug_id as int): {instance_id2}")

    # Bug case: instance_id is constructed elsewhere with string concatenation
    # Simulate what might happen in task preprocessing
    task3 = {"project": "django", "bug_id": 12345}
    with pytest.raises(TypeError):
        # This is the problematic pattern - explicit string concatenation
        task3["instance_id"] = task3["project"] + "_" + task3["bug_id"]


def test_task_id_suffix():
    """Test the pattern used for task_id construction."""

    # Case where instance_id might be an int
    instance_id = 12345
    task_id = f"{instance_id}:mcp"
    print(f"✓ F-string handles int task_id: {task_id}")

    # Case where someone uses + instead of f-string
    _ = str(instance_id) + ":mcp"  # This works (verify no error)
    with pytest.raises(TypeError):
        _ = instance_id + ":mcp"  # This should fail


if __name__ == "__main__":
    print("Testing string concatenation patterns...")
    print("=" * 60)

    test_instance_id_construction()
    print()
    test_task_id_suffix()

    print("=" * 60)
    print("✓ Bug reproduced! String + int concatenation causes TypeError")
    sys.exit(0)
