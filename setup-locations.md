# AI Agent Roles - Setup Locations Guide

## Option 1: Continue.dev Configuration Directory (RECOMMENDED)

### Location by OS:
- **macOS**: `~/.continue/`
- **Linux**: `~/.continue/`
- **Windows**: `%USERPROFILE%\.continue\`

### Setup Structure:
```
~/.continue/
├── config.json           # Your Continue configuration
├── agent-roles/         # Create this folder
│   ├── roles.md         # Role definitions
│   ├── prompts.md       # System prompts
│   └── cost-tracker.md  # Cost tracking
└── rules/               # Continue's rules folder (if using)
```

### How to set up (macOS/Linux):
```bash
# Create the agent-roles directory
mkdir -p ~/.continue/agent-roles

# Move the files there
mv ai-agent-roles.md ~/.continue/agent-roles/roles.md
mv agent-prompts.md ~/.continue/agent-roles/prompts.md
mv cost-optimization-tracker.md ~/.continue/agent-roles/cost-tracker.md
```

### How to set up (Windows):
```powershell
# Create the agent-roles directory
New-Item -Path "$env:USERPROFILE\.continue\agent-roles" -ItemType Directory -Force

# Move the files there
Move-Item ai-agent-roles.md "$env:USERPROFILE\.continue\agent-roles\roles.md"
Move-Item agent-prompts.md "$env:USERPROFILE\.continue\agent-roles\prompts.md"
Move-Item cost-optimization-tracker.md "$env:USERPROFILE\.continue\agent-roles\cost-tracker.md"
```

---

## Option 2: Custom Global Directory

### Create a dedicated directory:
```bash
# macOS/Linux
mkdir -p ~/Documents/ai-agents
# or
mkdir -p ~/.config/ai-agents

# Windows
New-Item -Path "$env:USERPROFILE\Documents\ai-agents" -ItemType Directory
```

### Structure:
```
~/Documents/ai-agents/
├── README.md
├── roles/
│   ├── code-scout.md
│   ├── architect.md
│   ├── debug-detective.md
│   ├── documentation-expert.md
│   └── quality-guardian.md
├── configs/
│   ├── continue-config.json
│   └── cursor-rules.md
├── prompts/
│   └── system-prompts.md
└── tracking/
    └── cost-tracker.xlsx
```

---

## Option 3: Git Repository (BEST for team sharing)

### Setup:
```bash
# Create a repo for your AI configurations
mkdir ~/ai-agent-config
cd ~/ai-agent-config
git init

# Add your files
cp ~/ai-agent-roles.md .
cp ~/agent-prompts.md .
cp ~/cost-optimization-tracker.md .

# Create a Continue config template
cat > continue-config-template.json << 'EOF'
{
  "models": [
    {
      "title": "Code Scout",
      "provider": "ollama",
      "model": "deepseek-coder:latest",
      "systemMessage": "See prompts.md for full prompt"
    }
  ]
}
EOF

# Commit and push to GitHub/GitLab
git add .
git commit -m "Initial AI agent configuration"
git remote add origin YOUR_REPO_URL
git push -u origin main
```

### Then in each project:
```bash
# Clone as submodule
git submodule add YOUR_REPO_URL .ai-config

# Or just reference it in your Continue config
```

---

## Integrating with Continue.dev

### Update your Continue config.json:

```json
{
  "customCommands": [
    {
      "name": "agent-help",
      "description": "Show AI agent roles",
      "command": "cat ~/.continue/agent-roles/roles.md"
    }
  ],
  "contextProviders": [
    {
      "name": "file",
      "params": {
        "path": "~/.continue/agent-roles/prompts.md"
      }
    }
  ],
  "models": [
    {
      "title": "Code Scout (Local)",
      "provider": "ollama",
      "model": "deepseek-coder:latest",
      "systemMessageFile": "~/.continue/agent-roles/prompts/code-scout.txt"
    },
    {
      "title": "Architect",
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022",
      "systemMessageFile": "~/.continue/agent-roles/prompts/architect.txt"
    },
    {
      "title": "Debug Detective (Local)",
      "provider": "ollama", 
      "model": "nemotron:latest",
      "systemMessageFile": "~/.continue/agent-roles/prompts/debug-detective.txt"
    },
    {
      "title": "Documentation Expert",
      "provider": "anthropic",
      "model": "claude-3-haiku-20240307",
      "systemMessageFile": "~/.continue/agent-roles/prompts/documentation.txt"
    },
    {
      "title": "Quality Guardian",
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022",
      "systemMessageFile": "~/.continue/agent-roles/prompts/quality-guardian.txt"
    }
  ]
}
```

---

## Quick Access Aliases

### Add to your shell config (~/.zshrc, ~/.bashrc, or PowerShell profile):

```bash
# macOS/Linux (.zshrc or .bashrc)
alias ai-roles="cat ~/.continue/agent-roles/roles.md"
alias ai-prompts="cat ~/.continue/agent-roles/prompts.md"
alias ai-costs="cat ~/.continue/agent-roles/cost-tracker.md"
alias ai-edit="code ~/.continue/agent-roles/"

# PowerShell (Microsoft.PowerShell_profile.ps1)
function ai-roles { Get-Content "$env:USERPROFILE\.continue\agent-roles\roles.md" }
function ai-prompts { Get-Content "$env:USERPROFILE\.continue\agent-roles\prompts.md" }
function ai-costs { Get-Content "$env:USERPROFILE\.continue\agent-roles\cost-tracker.md" }
function ai-edit { code "$env:USERPROFILE\.continue\agent-roles\" }
```

---

## VS Code Integration

### Create a VS Code snippet for quick reference:

1. Open VS Code Command Palette (Cmd/Ctrl + Shift + P)
2. Type "Configure User Snippets"
3. Select "markdown.json"
4. Add:

```json
{
  "AI Agent Roles": {
    "prefix": "!agents",
    "body": [
      "# Quick Agent Reference",
      "- **Code Scout** (!scout): Local, quick fixes",
      "- **Architect** (!arch): Sonnet, system design", 
      "- **Debug Detective** (!debug): Local, debugging",
      "- **Documentation** (!docs): Haiku, documentation",
      "- **Quality Guardian** (!review): Sonnet, final review"
    ]
  }
}
```

---

## Continue Rules Integration

If you want these as Continue rules that automatically apply:

```bash
# Create rules in Continue directory
cd ~/.continue
mkdir -p rules

# Create a rule file for agent selection
cat > rules/agent-selection.md << 'EOF'
---
name: Agent Selection Guide
---

When helping with code, consider which agent role would be best:
- Simple fixes/refactoring → Code Scout (local)
- Architecture/design → Architect (Sonnet)
- Debugging → Debug Detective (local first)
- Documentation → Documentation Expert (Haiku)
- Final review → Quality Guardian (Sonnet)

Always start with local models when possible for cost optimization.
EOF
```

---

## Sync Across Machines

### Using cloud sync services:
```bash
# Example with iCloud (macOS)
ln -s ~/Library/Mobile\ Documents/com~apple~CloudDocs/ai-agents ~/.continue/agent-roles

# Example with Dropbox
ln -s ~/Dropbox/ai-agents ~/.continue/agent-roles

# Example with OneDrive
ln -s ~/OneDrive/ai-agents ~/.continue/agent-roles
```

---

## Verification

After setup, verify everything works:

```bash
# Check if files are accessible
ls -la ~/.continue/agent-roles/

# Test in Continue
# Open any project and use @file to reference:
# @~/.continue/agent-roles/roles.md

# Or use custom commands if configured
```