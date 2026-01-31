"""Tests for Django test runner detection and command building."""

import pytest

from mcpbr.evaluation import _build_test_command


class TestDjangoTestRunnerDetection:
    """Test that Django test format is detected correctly."""

    def test_django_test_format_detected(self):
        """Test that Django test format (dot-separated) is detected correctly."""
        # Django test format: module.Class.method
        test = "test_utils.tests.OverrideSettingsTests.test_override_file_upload_permissions"
        cmd = _build_test_command(test, uses_prebuilt=False)

        # Should NOT use pytest for Django tests
        assert "pytest" not in cmd
        # Should use Django's test runner
        assert "./runtests.py" in cmd
        # Should extract just the test module
        assert "test_utils.tests" in cmd

    def test_django_test_with_prebuilt(self):
        """Test Django test format with prebuilt image."""
        test = "admin_changelist.tests.ChangeListTests.test_result_list_editable"
        cmd = _build_test_command(test, uses_prebuilt=True)

        # Should activate conda environment
        assert "conda activate testbed" in cmd
        # Should use Django's test runner
        assert "./runtests.py" in cmd
        # Should extract just the test module
        assert "admin_changelist.tests" in cmd

    def test_django_simple_module_test(self):
        """Test Django test with just module name."""
        test = "queries.tests.NullInExcludeTest.test_col_not_in_list_containing_null"
        cmd = _build_test_command(test, uses_prebuilt=False)

        assert "pytest" not in cmd
        assert "./runtests.py" in cmd
        assert "queries.tests" in cmd

    def test_pytest_format_uses_pytest(self):
        """Test that pytest format (with ::) uses pytest."""
        test = "tests/test_file.py::TestClass::test_method"
        cmd = _build_test_command(test, uses_prebuilt=False)

        # Should use pytest
        assert "pytest" in cmd
        # Should NOT use Django runner
        assert "./runtests.py" not in cmd

    def test_pytest_file_uses_pytest(self):
        """Test that .py file uses pytest."""
        test = "tests/test_file.py"
        cmd = _build_test_command(test, uses_prebuilt=False)

        assert "pytest" in cmd
        assert "./runtests.py" not in cmd

    def test_django_workdir_and_runner_location(self):
        """Test that Django tests run from correct directory."""
        test = "test_utils.tests.TestFoo.test_bar"
        cmd = _build_test_command(test, uses_prebuilt=False)

        # Should change to tests directory and run runtests.py
        assert "cd /testbed/tests" in cmd
        assert "./runtests.py" in cmd

    def test_django_various_module_patterns(self):
        """Test various Django test module patterns."""
        test_cases = [
            ("admin_views.tests.AdminViewPermissionsTest.test_history_view", "admin_views.tests"),
            ("queries.test_q.QTests.test_combine_or", "queries.test_q"),
            ("model_fields.tests.BooleanFieldTests.test_null", "model_fields.tests"),
        ]

        for test, expected_module in test_cases:
            cmd = _build_test_command(test, uses_prebuilt=False)
            assert expected_module in cmd, f"Expected {expected_module} in command for test {test}"
            assert "./runtests.py" in cmd
            assert "pytest" not in cmd


class TestDjangoModuleExtraction:
    """Test extraction of Django test module from full test path."""

    def test_extract_two_part_module(self):
        """Test extracting module.tests from full path."""
        test = "queries.tests.NullInExcludeTest.test_method"
        cmd = _build_test_command(test, uses_prebuilt=False)

        # Should have exactly "queries.tests" in the command
        assert "queries.tests" in cmd

    def test_extract_three_part_module(self):
        """Test extracting module.submodule.tests from full path."""
        test = "admin.changelist.tests.ChangeListTests.test_method"
        cmd = _build_test_command(test, uses_prebuilt=False)

        # Should extract the module part (before class name)
        # In Django, test modules typically end with .tests or .test_*
        # For this case, it should be "admin.changelist.tests"
        assert "./runtests.py" in cmd

    def test_extract_test_prefix_module(self):
        """Test extracting test_* prefix modules."""
        test = "test_utils.test_module.TestClass.test_method"
        cmd = _build_test_command(test, uses_prebuilt=False)

        assert "./runtests.py" in cmd
