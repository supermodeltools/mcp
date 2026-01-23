#!/bin/bash

# Supermodel MCP Server Setup Script
# This script configures the MCP_TOOL_TIMEOUT environment variable

set -e

TIMEOUT_VALUE="900000"
EXPORT_LINE="export MCP_TOOL_TIMEOUT=${TIMEOUT_VALUE}"

echo ""
echo "Supermodel MCP Server Setup"
echo "============================"
echo ""

# Set timeout for this script process (won't affect your terminal)
export MCP_TOOL_TIMEOUT=${TIMEOUT_VALUE}
echo "✓ Will set MCP_TOOL_TIMEOUT=${TIMEOUT_VALUE} (reload shell to apply)"

# Detect user's shell
SHELL_NAME=$(basename "$SHELL")
PROFILE_FILE=""

if [ "$SHELL_NAME" = "zsh" ]; then
    PROFILE_FILE="$HOME/.zshrc"
elif [ "$SHELL_NAME" = "bash" ]; then
    # For bash, prefer .bash_profile for login shells (macOS/Linux)
    # If .bash_profile exists but doesn't source .bashrc, warn the user
    if [ -f "$HOME/.bash_profile" ]; then
        PROFILE_FILE="$HOME/.bash_profile"
        if [ -f "$HOME/.bashrc" ] && ! grep -q "\.bashrc" "$HOME/.bash_profile"; then
            echo "⚠ Note: Your .bash_profile doesn't source .bashrc"
            echo "   Consider adding: source ~/.bashrc"
        fi
    elif [ -f "$HOME/.bashrc" ]; then
        PROFILE_FILE="$HOME/.bashrc"
    else
        PROFILE_FILE="$HOME/.bashrc"
    fi
else
    echo "⚠ Warning: Unsupported shell ($SHELL_NAME). Defaulting to ~/.bashrc"
    PROFILE_FILE="$HOME/.bashrc"
fi

# Check if the export line already exists in the profile
if [ -f "$PROFILE_FILE" ] && grep -q "^export MCP_TOOL_TIMEOUT=" "$PROFILE_FILE"; then
    echo "✓ MCP_TOOL_TIMEOUT already configured in $PROFILE_FILE"
else
    # Add the export line to the profile
    echo "" >> "$PROFILE_FILE"
    echo "# Supermodel MCP Server timeout configuration" >> "$PROFILE_FILE"
    echo "$EXPORT_LINE" >> "$PROFILE_FILE"
    echo "✓ Added MCP_TOOL_TIMEOUT to $PROFILE_FILE"
fi

echo ""
echo "Next Steps:"
echo "==========="
echo ""
echo "1. Reload your shell profile:"
echo "   source $PROFILE_FILE"
echo ""
echo "2. Get your API key from:"
echo "   https://dashboard.supermodeltools.com"
echo ""
echo "3. Set your API key globally (recommended):"
echo "   echo 'export SUPERMODEL_API_KEY=\"your-api-key\"' >> $PROFILE_FILE"
echo "   source $PROFILE_FILE"
echo ""
echo "4. Install the MCP server:"
echo "   npm install -g @supermodeltools/mcp-server"
echo ""
echo "5. Add the server to your MCP client:"
echo "   - For Claude Code:"
echo "     claude mcp add supermodel -- npx -y @supermodeltools/mcp-server"
echo ""
echo "   - For Cursor/Claude Desktop:"
echo "     Add to your MCP config file:"
echo "     {"
echo "       \"mcpServers\": {"
echo "         \"supermodel\": {"
echo "           \"command\": \"npx\","
echo "           \"args\": [\"-y\", \"@supermodeltools/mcp-server\"]"
echo "         }"
echo "       }"
echo "     }"
echo ""
echo "Setup complete! ✓"
echo ""
