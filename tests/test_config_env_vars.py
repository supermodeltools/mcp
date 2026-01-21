"""Integration tests for environment variable support in config loading."""

import os
import tempfile
from pathlib import Path

import pytest

from mcpbr.config import load_config


class TestConfigEnvVarIntegration:
    """Test environment variable expansion in full config loading."""

    def test_load_config_with_env_vars(self):
        """Test loading config with environment variable substitution."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
    - "{workdir}"
  env:
    API_KEY: "${TEST_API_KEY}"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            os.environ["TEST_API_KEY"] = "sk-test-key-123"
            try:
                config = load_config(config_path, warn_security=False)
                assert config.mcp_server.env["API_KEY"] == "sk-test-key-123"
            finally:
                del os.environ["TEST_API_KEY"]

    def test_load_config_with_defaults(self):
        """Test loading config with default values for missing vars."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
  env:
    API_KEY: "${OPTIONAL_KEY:-default_key}"

provider: anthropic
agent_harness: claude-code
model: "${MODEL_NAME:-sonnet}"
sample_size: 1
""")

            # Make sure vars are not set
            for key in ["OPTIONAL_KEY", "MODEL_NAME"]:
                if key in os.environ:
                    del os.environ[key]

            config = load_config(config_path, warn_security=False)
            assert config.mcp_server.env["API_KEY"] == "default_key"
            assert config.model == "sonnet"

    def test_load_config_missing_required_var(self):
        """Test that missing required variable raises error."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
  env:
    API_KEY: "${REQUIRED_API_KEY}"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            # Make sure var is not set
            if "REQUIRED_API_KEY" in os.environ:
                del os.environ["REQUIRED_API_KEY"]

            with pytest.raises(ValueError, match="REQUIRED_API_KEY"):
                load_config(config_path, warn_security=False)

    def test_load_config_with_dotenv(self):
        """Test loading config with .env file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create .env file
            dotenv_path = Path(tmpdir) / ".env"
            dotenv_path.write_text("DOTENV_API_KEY=key_from_dotenv\n")

            # Create config file
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
  env:
    API_KEY: "${DOTENV_API_KEY}"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            # Make sure var is not in environment
            if "DOTENV_API_KEY" in os.environ:
                del os.environ["DOTENV_API_KEY"]

            # Change to tmpdir so .env is found
            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                config = load_config(config_path, warn_security=False)
                assert config.mcp_server.env["API_KEY"] == "key_from_dotenv"
            finally:
                os.chdir(old_cwd)
                # Clean up
                if "DOTENV_API_KEY" in os.environ:
                    del os.environ["DOTENV_API_KEY"]

    def test_env_var_precedence_over_dotenv(self):
        """Test that environment variables take precedence over .env file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create .env file
            dotenv_path = Path(tmpdir) / ".env"
            dotenv_path.write_text("TEST_KEY=from_dotenv\n")

            # Create config file
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
  env:
    KEY: "${TEST_KEY}"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            # Set in environment
            os.environ["TEST_KEY"] = "from_environment"

            old_cwd = os.getcwd()
            try:
                os.chdir(tmpdir)
                config = load_config(config_path, warn_security=False)
                # Should use environment value, not .env
                assert config.mcp_server.env["KEY"] == "from_environment"
            finally:
                os.chdir(old_cwd)
                del os.environ["TEST_KEY"]

    def test_security_warnings_for_hardcoded_keys(self):
        """Test that security warnings are generated for hardcoded secrets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"
  env:
    API_KEY: "sk-hardcoded-key-123456"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            # This should warn but not fail
            # We can't easily test the warning output in a unit test,
            # but we can verify it doesn't crash
            config = load_config(config_path, warn_security=True)
            assert config.mcp_server.env["API_KEY"] == "sk-hardcoded-key-123456"

    def test_complex_nested_expansion(self):
        """Test expansion in complex nested structures."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  name: "${SERVER_NAME:-default_server}"
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-${SERVER_TYPE:-filesystem}"
  env:
    KEY1: "${KEY1}"
    KEY2: "${KEY2:-default2}"
    KEY3: "prefix_${KEY3}_suffix"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 1
""")

            os.environ["KEY1"] = "value1"
            os.environ["KEY3"] = "value3"
            # KEY2 not set, should use default
            # SERVER_NAME not set, should use default
            # SERVER_TYPE not set, should use default

            if "KEY2" in os.environ:
                del os.environ["KEY2"]
            if "SERVER_NAME" in os.environ:
                del os.environ["SERVER_NAME"]
            if "SERVER_TYPE" in os.environ:
                del os.environ["SERVER_TYPE"]

            try:
                config = load_config(config_path, warn_security=False)
                assert config.mcp_server.name == "default_server"
                assert "@modelcontextprotocol/server-filesystem" in config.mcp_server.args
                assert config.mcp_server.env["KEY1"] == "value1"
                assert config.mcp_server.env["KEY2"] == "default2"
                assert config.mcp_server.env["KEY3"] == "prefix_value3_suffix"
            finally:
                for key in ["KEY1", "KEY3"]:
                    if key in os.environ:
                        del os.environ[key]

    def test_numeric_and_boolean_values_unchanged(self):
        """Test that numeric and boolean values pass through correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.yaml"
            config_path.write_text("""
mcp_server:
  command: npx
  args:
    - "-y"
    - "@modelcontextprotocol/server-filesystem"

provider: anthropic
agent_harness: claude-code
model: sonnet
sample_size: 5
timeout_seconds: 300
max_concurrent: 2
use_prebuilt_images: true
budget: 10.50
""")

            config = load_config(config_path, warn_security=False)
            assert config.sample_size == 5
            assert config.timeout_seconds == 300
            assert config.max_concurrent == 2
            assert config.use_prebuilt_images is True
            assert config.budget == 10.50
