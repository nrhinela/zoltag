#!/bin/bash

# Setup script for Continue.dev AI Agent Roles
# Works on macOS and Linux

echo "🚀 Setting up AI Agent Roles for Continue.dev..."

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    CONTINUE_DIR="$HOME/.continue"
    echo "📍 Detected macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CONTINUE_DIR="$HOME/.continue"
    echo "📍 Detected Linux"
else
    echo "⚠️  Windows detected. Please use setup-continue-agents.ps1 instead"
    exit 1
fi

# Check if Continue directory exists
if [ ! -d "$CONTINUE_DIR" ]; then
    echo "❌ Continue directory not found at $CONTINUE_DIR"
    echo "Please install Continue.dev extension first"
    exit 1
fi

echo "✅ Found Continue directory at $CONTINUE_DIR"

# Create agent-roles directory
AGENT_DIR="$CONTINUE_DIR/agent-roles"
mkdir -p "$AGENT_DIR"
echo "📁 Created $AGENT_DIR"

# Move or copy files
echo "📄 Setting up agent role files..."

# Check if files exist in current directory and move them
if [ -f "ai-agent-roles.md" ]; then
    cp "ai-agent-roles.md" "$AGENT_DIR/roles.md"
    echo "  ✓ Copied roles.md"
fi

if [ -f "agent-prompts.md" ]; then
    cp "agent-prompts.md" "$AGENT_DIR/prompts.md"
    echo "  ✓ Copied prompts.md"
fi

if [ -f "cost-optimization-tracker.md" ]; then
    cp "cost-optimization-tracker.md" "$AGENT_DIR/cost-tracker.md"
    echo "  ✓ Copied cost-tracker.md"
fi

# Create individual prompt files for easier reference
PROMPTS_DIR="$AGENT_DIR/prompts"
mkdir -p "$PROMPTS_DIR"

# Create individual system prompt files
cat > "$PROMPTS_DIR/code-scout.txt" << 'EOF'
You are Code Scout, a practical coding assistant optimized for quick tasks.

Your priorities:
1. Provide working code immediately
2. Keep explanations brief unless asked
3. Focus on common patterns and standard solutions
4. Suggest simple, maintainable approaches

You excel at: Code completion, syntax fixes, simple refactoring, basic CRUD operations
EOF

cat > "$PROMPTS_DIR/architect.txt" << 'EOF'
You are Architect, a senior software architect with 15+ years of experience.

Your approach:
1. Consider scalability, maintainability, and performance
2. Evaluate multiple design options with trade-offs
3. Apply relevant design patterns appropriately
4. Think about system integration and future growth

Always provide:
- Rationale for architectural decisions
- Alternative approaches with pros/cons
- Implementation roadmap
EOF

cat > "$PROMPTS_DIR/debug-detective.txt" << 'EOF'
You are Debug Detective, a systematic debugging specialist.

Your methodology:
1. Analyze symptoms before suggesting solutions
2. Consider edge cases and boundary conditions
3. Provide step-by-step debugging strategies

Format responses as:
- Likely cause: [hypothesis]
- Quick check: [immediate test]
- Fix: [solution]
EOF

cat > "$PROMPTS_DIR/documentation.txt" << 'EOF'
You are Documentation Expert, a technical writer focused on clarity.

Guidelines:
1. Write for developers of varying experience levels
2. Include practical examples for complex concepts
3. Use consistent terminology and style
4. Balance completeness with conciseness

Use active voice, include code examples, and provide troubleshooting sections.
EOF

cat > "$PROMPTS_DIR/quality-guardian.txt" << 'EOF'
You are Quality Guardian, a senior engineer responsible for code quality.

Review checklist:
1. Security vulnerabilities (OWASP Top 10)
2. Performance bottlenecks and memory leaks
3. Error handling and edge cases
4. Code maintainability and readability
5. Test coverage and testability

Provide feedback as:
🔴 Critical: Must fix before deployment
🟡 Important: Should address soon
🟢 Suggestion: Nice to have improvement
EOF

echo "  ✓ Created individual prompt files"

# Backup existing config.yaml if it exists
if [ -f "$CONTINUE_DIR/config.yaml" ]; then
    cp "$CONTINUE_DIR/config.yaml" "$CONTINUE_DIR/config.yaml.backup"
    echo "📦 Backed up existing config.yaml to config.yaml.backup"
fi

# Create a sample config if continue-config-agents.yaml exists
if [ -f "continue-config-agents.yaml" ]; then
    cp "continue-config-agents.yaml" "$AGENT_DIR/sample-config.yaml"
    echo "  ✓ Copied sample config to $AGENT_DIR/sample-config.yaml"
    echo ""
    echo "⚠️  IMPORTANT: To use the agent roles, you need to merge"
    echo "   $AGENT_DIR/sample-config.yaml"
    echo "   with your existing $CONTINUE_DIR/config.yaml"
fi

# Add shell aliases
echo ""
echo "🔧 Adding shell aliases..."

# Detect shell
if [ -n "$ZSH_VERSION" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -n "$BASH_VERSION" ]; then
    SHELL_RC="$HOME/.bashrc"
else
    SHELL_RC="$HOME/.bashrc"
fi

# Check if aliases already exist
if ! grep -q "ai-roles" "$SHELL_RC" 2>/dev/null; then
    cat >> "$SHELL_RC" << EOF

# AI Agent Roles for Continue.dev
alias ai-roles="cat $AGENT_DIR/roles.md"
alias ai-prompts="cat $AGENT_DIR/prompts.md"
alias ai-costs="cat $AGENT_DIR/cost-tracker.md"
alias ai-edit="code $AGENT_DIR"
EOF
    echo "  ✓ Added aliases to $SHELL_RC"
else
    echo "  ℹ Aliases already exist in $SHELL_RC"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Quick Reference:"
echo "  • Agent roles documentation: $AGENT_DIR/roles.md"
echo "  • System prompts: $AGENT_DIR/prompts/"
echo "  • Cost tracker: $AGENT_DIR/cost-tracker.md"
echo "  • Sample config: $AGENT_DIR/sample-config.yaml"
echo ""
echo "🎯 Next Steps:"
echo "  1. Merge $AGENT_DIR/sample-config.yaml with your config.yaml"
echo "  2. Reload your shell: source $SHELL_RC"
echo "  3. Use aliases: ai-roles, ai-prompts, ai-costs, ai-edit"
echo "  4. In Continue, use slash commands: /scout, /debug, /docs, /architect, /review"
echo ""
echo "💡 Tip: Start with /scout for most tasks to save costs!"